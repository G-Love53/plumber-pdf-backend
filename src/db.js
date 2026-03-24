import pg from "pg";

const { Pool } = pg;

let pool = null;

function createPool() {
  if (!process.env.DATABASE_URL) {
    console.warn("[db] DATABASE_URL not set; Postgres features disabled.");
    return null;
  }

  const config = {
    connectionString: process.env.DATABASE_URL,
  };

  if (process.env.PGSSLMODE !== "disable") {
    config.ssl = { rejectUnauthorized: false };
  }

  return new Pool(config);
}

export function getPool() {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

/**
 * Same CID schema contract as pdf-backend (Bar): upsert client, generate
 * submission_public_id, insert submission + timeline. No operator notification
 * (that lives only on the central API).
 */
export async function recordSubmission({
  segment,
  sourceDomain,
  sourceForm,
  rawSubmission,
  primaryEmail,
  primaryPhone,
  firstName,
  lastName,
}) {
  const poolInstance = getPool();
  if (!poolInstance) return null;
  if (!primaryEmail) return null;

  const client = await poolInstance.connect();
  try {
    await client.query("BEGIN");

    const clientRes = await client.query(
      `
        INSERT INTO clients (primary_email, primary_phone, first_name, last_name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (primary_email)
        DO UPDATE SET
          primary_phone = COALESCE(EXCLUDED.primary_phone, clients.primary_phone),
          updated_at    = NOW()
        RETURNING client_id
      `,
      [primaryEmail, primaryPhone || null, firstName || null, lastName || null],
    );

    const clientId = clientRes.rows[0]?.client_id;
    if (!clientId) {
      await client.query("ROLLBACK");
      return null;
    }

    const seg = (segment || "bar").toLowerCase();
    const segEnum =
      seg === "bar" || seg === "roofer" || seg === "plumber" || seg === "hvac"
        ? seg
        : "bar";

    const idRes = await client.query(
      `SELECT generate_submission_public_id($1::segment_type) AS id`,
      [segEnum],
    );
    const submissionPublicId = idRes.rows[0]?.id;
    if (!submissionPublicId) {
      await client.query("ROLLBACK");
      return null;
    }

    const subRes = await client.query(
      `
        INSERT INTO submissions (
          submission_public_id,
          client_id,
          segment,
          source_domain,
          source_form,
          raw_submission_json,
          status
        )
        VALUES ($1, $2, $3::segment_type, $4, $5, $6, 'received')
        RETURNING submission_id
      `,
      [
        submissionPublicId,
        clientId,
        segEnum,
        sourceDomain || "unknown",
        sourceForm || null,
        rawSubmission,
      ],
    );

    const submissionId = subRes.rows[0]?.submission_id;
    if (!submissionId) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `
        INSERT INTO timeline_events (
          client_id,
          submission_id,
          event_type,
          event_label,
          event_payload_json,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        clientId,
        submissionId,
        "submission.received",
        "Submission received from form endpoint",
        rawSubmission,
        "system",
      ],
    );

    await client.query("COMMIT");
    return { clientId, submissionId, submissionPublicId };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    console.error("[db] recordSubmission error:", err.message || err);
    return null;
  } finally {
    client.release();
  }
}
