// src/services/endorsements/endorsementNormalizer.js
import { getEndorsementBible } from "./endorsementLoader.js";

/**
 * Normalize messy human text -> canonical endorsement codes + deterministic flags
 *
 * @param {string|string[]} textInput
 * @returns {{ codes: string[], flags: string[], matched: Array<{code:string, via:string}> }}
 */
export function normalizeEndorsements(textInput) {
  const bible = getEndorsementBible();
  const { catalog, rules, aliasToCode, byCode } = bible;

  const text = Array.isArray(textInput)
    ? textInput.filter(Boolean).join("\n")
    : (textInput || "");

  const haystack = text.toLowerCase();

  const foundCodes = new Set();
  const matched = [];

  // 1) Direct alias matching (simple + reliable)
  // We do "contains" matching for each alias token.
  // For short tokens like "waiver", this is fine; if it gets noisy later,
  // we can upgrade to boundary-aware regex.
  for (const [alias, code] of aliasToCode.entries()) {
    if (!alias) continue;
    if (haystack.includes(alias)) {
      if (!foundCodes.has(code)) {
        foundCodes.add(code);
      }
      matched.push({ code, via: alias });
    }
  }

  // 2) Signals matching (from requirements_signals)
  // (This helps when aliases are sparse and signals are richer)
  for (const e of catalog.endorsements) {
    const code = e?.code;
    if (!code) continue;

    const signals = Array.isArray(e.requirements_signals)
      ? e.requirements_signals
      : [];

    for (const s of signals) {
      const token = String(s || "").trim().toLowerCase();
      if (!token) continue;
      if (haystack.includes(token)) {
        if (!foundCodes.has(code)) {
          foundCodes.add(code);
          matched.push({ code, via: `signal:${token}` });
        }
      }
    }
  }

  // 3) Apply deterministic rules -> flags and/or additional endorsements
  const codesArr = Array.from(foundCodes);

  const flags = new Set();

  for (const r of rules.rules) {
    const ifAll = Array.isArray(r.if_all) ? r.if_all : null;
    const ifMissing = Array.isArray(r.if_missing) ? r.if_missing : null;
    const ifAnySignals = Array.isArray(r.if_any_signals) ? r.if_any_signals : null;

    let ok = true;

    if (ifAll) {
      for (const c of ifAll) {
        if (!foundCodes.has(c)) ok = false;
      }
    }

    if (ok && ifMissing) {
      for (const c of ifMissing) {
        if (foundCodes.has(c)) ok = false;
      }
    }

    if (ok && ifAnySignals) {
      const hit = ifAnySignals.some(sig =>
        haystack.includes(String(sig || "").toLowerCase())
      );
      if (!hit) ok = false;
    }

    if (!ok) continue;

    const then = r.then || {};
    const addEndorsements = Array.isArray(then.add_endorsements)
      ? then.add_endorsements
      : [];
    const setFlags = Array.isArray(then.set_flags) ? then.set_flags : [];

    for (const c of addEndorsements) {
      // only add if it's a valid catalog code
      if (byCode.has(c)) foundCodes.add(c);
    }
    for (const f of setFlags) flags.add(f);
  }

  // 4) Final: stable ordering (important for test + diff consistency)
  const finalCodes = Array.from(foundCodes).sort();
  const finalFlags = Array.from(flags).sort();

  return {
    codes: finalCodes,
    flags: finalFlags,
    matched
  };
}
