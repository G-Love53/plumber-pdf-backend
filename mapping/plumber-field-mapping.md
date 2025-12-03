# Plumber Form → EJS Template Field Mapping

## ✅ Direct Matches (1:1)

### Business Information
| HTML Form Field | EJS Template Path | Status |
|----------------|-------------------|---------|
| `applicant_name` | `data.agent_applicant.applicant_name` | ✅ Direct |
| `business_name` | N/A | Form only |
| `business_structure` | `data.agent_applicant.business_structure` | ✅ Direct |
| `mailing_address` | `data.agent_applicant.mailing_address` | ✅ Auto-generated |
| `applicant_phone` | `data.agent_applicant.applicant_phone` | ✅ Auto-generated |
| `contact_email` | N/A | Form only |

### Experience & Licensing
| HTML Form Field | EJS Template Path | Status |
|----------------|-------------------|---------|
| `years_in_business` | `data.experience_licensing.years_in_business` | ✅ Direct |
| `years_experience` | `data.experience_licensing.years_experience` | ✅ Fixed |
| `is_licensed` | `data.experience_licensing.is_licensed` | ✅ Added |
| `license_number` | `data.experience_licensing.license_number` | ✅ Added |
| `license_type` | `data.experience_licensing.license_type` | ✅ Added |

### Financial
| HTML Form Field | EJS Template Path | Status |
|----------------|-------------------|---------|
| `projected_gross_revenue` | `data.revenue.projected_revenue` | ✅ Direct |
| `number_active_owners` | N/A | Form only |
| `annual_payroll_excl_owners` | N/A | Form only |
| `estimated_annual_subcontract_cost` | N/A | Form only |

### Work Mix
| HTML Form Field | EJS Template Path | Status |
|----------------|-------------------|---------|
| `pct_residential` | Custom for plumbers | Form only |
| `pct_commercial` | Custom for plumbers | Form only |
| `pct_industrial` | Custom for plumbers | Form only |
| `pct_gc` | `data.work_mix.pct_gc` | ✅ Added |
| `pct_sub` | `data.work_mix.pct_sub` | ✅ Added |

### Subcontractor Controls
| HTML Form Field | EJS Template Path | Status |
|----------------|-------------------|---------|
| `hire_subs` | `data.sub_controls.hire_subs` | ✅ Added |
| `subs_require_coi` | `data.sub_controls.subs_require_coi` | ✅ Fixed |
| `subs_carry_lower_limits` | `data.sub_controls.subs_carry_lower_limits` | ✅ Added |
| `subs_min_limits` | `data.sub_controls.subs_min_limits` | ✅ Added |
| `subs_wc` | `data.sub_controls.subs_wc` | ✅ Added |
| `subs_contracts_holdharmless` | `data.sub_controls.subs_contracts_holdharmless` | ✅ Fixed |
| `subs_ai` | `data.sub_controls.subs_ai` | ✅ Added |
| `coi_retention_period` | `data.sub_controls.coi_retention_period` | ✅ Added |
| `use_independent_contractors` | N/A | Form only |
| `lease_employees` | `data.employment_corp.lease_employees` | ✅ Direct |
| `carry_workers_comp` | `data.employment_corp.workers_comp` | ✅ Direct |

### Plumbing Operations (Plumber-Specific)
| HTML Form Field | EJS Template Path | Status |
|----------------|-------------------|---------|
| `gas_line_work` | Custom plumber field | Form only |
| `boiler_work` | Custom plumber field | Form only |
| `industrial_plumbing_clients` | Custom plumber field | Form only |
| `high_pressure_steam_work` | Custom plumber field | Form only |
| `boiler_work_gas` | Custom plumber field | Form only |
| `welding_operations_gas` | Custom plumber field | Form only |
| `high_pressure_steam_gas` | Custom plumber field | Form only |
| `ac_unit_work` | Custom plumber field | Form only |
| `refrigeration_work` | Custom plumber field | Form only |

### Risk Questions
| HTML Form Field | EJS Template Path | Status |
|----------------|-------------------|---------|
| `work_repair_remodel` | `data.remodel_wrap_safety.do_remodeling` | ✅ Direct |
| `pct_repair_remodel` | N/A | Form only |
| `remodel_condos_hoas` | `data.remodel_wrap_safety.renovation_for_hoa` | ✅ Close match |
| `condo_conversions` | `data.remodel_wrap_safety.condo_conversions` | ✅ Direct |
| `welding_processes` | N/A | Form only |
| `mold_defect_losses` | `data.remodel_wrap_safety.any_defect_or_mold_claims` | ✅ Close match |
| `fire_water_restoration` | `data.prof_equip_env.fire_water_remediation` | ✅ Close match |
| `asbestos_lead_work` | `data.prof_equip_env.asbestos` | ✅ Direct |
| `hazardous_materials_handling` | `data.prof_equip_env.hazmat_ops` | ✅ Close match |
| `max_building_height` | `data.ops_exposures.max_height_stories` | ✅ Close match |
| `states_work_in` | `data.ops_exposures.out_of_state_details` | ✅ Close match |
| `work_below_grade` | N/A | Form only |
| `work_hillsides_slopes_landfills` | N/A | Form only |
| `work_tunnels_subways_utilities` | N/A | Form only |
| `operations_outside_construction` | N/A | Form only |
| `cranes_eifs_blasting` | `data.special_hazards.*` | Multiple fields |

### Cross-Trade
| HTML Form Field | EJS Template Path | Status |
|----------------|-------------------|---------|
| `roofing_operations` | N/A | Form only |
| `hvac_operations` | N/A | Form only |
| `specific_additional_insureds` | N/A | Form only |

### Current Coverage
| HTML Form Field | EJS Template Path | Status |
|----------------|-------------------|---------|
| `current_carrier` | N/A | Form only |
| `current_policy_exp` | N/A | Form only |
| `claims_3_years` | N/A | Form only |
| `claims_details` | N/A | Form only |

### Workers Comp Quote
| HTML Form Field | EJS Template Path | Status |
|----------------|-------------------|---------|
| `workers_comp_quote` | N/A | Form only |
| `wc_employees_ft` | N/A | Form only |
| `wc_employees_pt` | N/A | Form only |
| `wc_annual_payroll` | N/A | Form only |
| `payment_plan` | N/A | Form only |

---

## 🔧 Auto-Generated Fields (JavaScript)

These fields are created at form submission:

```javascript
// Concatenate address
mailing_address = `${premise_address}, ${premise_city}, ${premise_state} ${premise_zip}`

// Map phone
applicant_phone = business_phone
```

---

## 📝 EJS Fields That Will Be Blank (Expected)

These EJS template fields won't have data from the form (intentionally):

### Agent Information (Backend will hardcode)
- `agent_name`
- `agent_number` 
- `agent_phone`

### Policy Dates (Backend will generate)
- `policy_from`
- `policy_to`

### Advanced Fields Not Needed for Plumbers
- `locations` array
- `pct_new_construction`
- `pct_renovation`
- `pct_developer`
- `pct_other`
- `pct_employees`
- `pct_subs_under_supervision`
- Most residential/multi-unit fields
- Most special hazards detailed breakdown
- Trades breakdown table
- Revenue history (Y1, Y2, Y3)
- Largest jobs history
- Corporate history details

These will render as blank on the PDF, which is acceptable for plumber applications.

---

## ✅ Critical Fields Collected

All carrier-required plumber fields from Excel are collected:
1. ✅ Gas line work (with conditional follow-ups)
2. ✅ Boiler work
3. ✅ Industrial plumbing clients
4. ✅ High-pressure steam pipe work
5. ✅ All subcontractor management questions
6. ✅ All risk/safety questions

---

## Backend Mapping Notes

Your backend should:
1. Accept flat field names from form
2. Create nested structure for EJS (e.g., `data.agent_applicant.*`, `data.experience_licensing.*`)
3. Hardcode agent information
4. Generate policy dates
5. Leave blank fields as empty strings for EJS rendering
