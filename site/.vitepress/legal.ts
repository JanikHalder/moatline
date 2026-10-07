/**
 * Who runs the Moatline cloud — the one place the legal pages (terms,
 * privacy, refunds, imprint) read it from. Empty fields are left out of the
 * pages; fill in the hosting provider before going live.
 */
export const legal = {
  /** The legal entity that sells the cloud service. */
  company: "Janik Halder",
  /** Street, postcode, city, country. */
  address: "Seeweg 14, 6212 Eben am Achensee, Austria",
  email: "info@janikhalder.at",
  phone: "+43 676 9574767",
  /** Company register number and court, if registered (else empty). */
  register: "",
  /** VAT number (UID), if there is one (else empty). */
  vatId: "",
  /** Chamber membership / trade licence, as Austrian law asks for. */
  authority: "",
  /** Where the cloud runs. */
  hosting: "Hetzner Online GmbH, Gunzenhausen, Germany",
  /** Law and courts for disputes. */
  jurisdiction: "Austria",
  /** Date of the current version of the terms and privacy policy. */
  updated: "2026-10-06",
};
