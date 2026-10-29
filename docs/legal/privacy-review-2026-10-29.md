# Samly legal/privacy review — 29 October 2026

## Confirmed changes

User confirms operator IACy International FZCO and contact admin@iacy.com. Existing bilingual legal notice, Terms, EULA, Privacy Policy, Cancellation Policy, DPA and tax notice were present. Preserve B2B-only use, cancellation at any time, access through the paid period and no prorated refund subject to mandatory rights.

Updated privacy and processing language, provider roles, booking calendar, Microsoft integration, rights, AI review, retention criteria and transfer requirements. New terms incorporate the DPA; signup records the revised Terms/Privacy versions without rewriting historical acceptance records. Privacy acknowledgement is distinct from consent. The previous source is archived in `archive/2026-09-20-SamlyLegal.tsx.txt`.

Fixed legal alias routes and query-only navigation, added privacy disclosure before signup submits personal information, and added legal/privacy links on the scheduling page. No advertising/analytics integration was found in the reviewed source; necessary storage alone does not warrant an invented consent banner. External provider runtime storage still needs periodic checking.

## GDPR applicability assessment

Samly deliberately offers Austrian company setup and German-language service, so its operator should assess and meet GDPR duties rather than presume a UAE incorporation exempts it. Roles and applicable processing differ: account/booking administration is controller activity; customer ledger data is generally processed on instructions. Relevant UAE privacy law must also be assessed. This is implementation work, not a legal opinion or compliance certification.

## Outstanding factual and operational work

- Article 27 representative: the operator explicitly confirmed the formal appointment and current address of Nikolaus Skene, Skodagasse 28/5, 1080 Vienna, Austria, on 29 October 2026. Retain this designation; use admin@iacy.com as the confirmed public contact. This is not a DPO designation.
- Revalidate the existing registered address/licence against the current corporate record before treating the notice as a corporate verification. The user confirmed name and email; other details were retained from the existing site.
- Complete customer-specific processor annexes: exact vendor contracting entities, regions, remote access, retention, backup lifecycle and technical/organizational measures. Do not infer these from vendor brands or available source code.
- Execute/verify DPAs and appropriate Chapter V transfer arrangements, including the customer's transfer to the UAE operator where relevant; assess transfer impact and supplementary measures. The generic website DPA is not an executed SCC or complete transfer arrangement.
- Put the DPA commitments into operation: maintain a sub-processor register and advance change notices/objections, documented deletion/return workflow including backups, incident response, rights request handling, audit support and restore checks.
- Determine and record precise category-specific retention periods based on purpose and applicable law. No automatic deletion job was added or verified in this change.
- Consider whether a DPO or DPIA is required for actual processing; do not label the representative or contact mailbox a DPO without an appointment.
- Notify existing customers of material contract/privacy changes through an authorized process. No emails were sent, no previous acceptance was overwritten, and no retroactive acceptance is asserted.
- New signup records DPA incorporation via the Terms version. The existing database ledger has no separate DPA row; no schema migration is included in this website release.
- DocFlow is not connected; do not list it as an active recipient. Update notices and agreements before enabling it.

## Sources checked

- EDPB territorial scope guidance: https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_3_2018_territorial_scope_after_public_consultation_en_1.pdf
- EDPB controller/processor duties: https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en
- European Commission GDPR application and processor contracts: https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en
- EDPB international transfers: https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en
- UAE official privacy-law overview: https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws

## Release boundary

Publish only the legal, signup-disclosure and schedule-footer changes. Do not include the uncommitted e-invoicing implementation. Verify English/German notices, legal tabs and aliases, mailto, signup privacy access, and existing calendar on the isolated release. This does not verify full signup provisioning, deletion or provider agreements in production.
