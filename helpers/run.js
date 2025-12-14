import axios from "axios";

const BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";
const TOKEN = "pit-04ee49b1-2e1c-4276-ba9c-7e20b3cacb3c"; 
const LOCATION_ID = "FmyBGGVhzMmKaYko3PsW";


if (!TOKEN || !LOCATION_ID) {
  console.error("Set env vars: GHL_PRIVATE_TOKEN and GHL_LOCATION_ID");
  process.exit(1);
}

async function listObjectsRaw() {
  const url = `${BASE}/objects/`;
  console.log("GET", url, "locationId=", LOCATION_ID);
  const resp = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Version: API_VERSION,
      Accept: "application/json",
    },
    params: { locationId: LOCATION_ID },
  });
  return resp;
}

function extractObjectsFromResponse(resp) {
  const d = resp.data;
  console.log("DEBUG: full response.data (truncated):", JSON.stringify(d, (k, v) => {
    // avoid giant logs — still include top-level keys
    if (typeof v === "string" && v.length > 300) return v.slice(0, 300) + "...";
    return v;
  }, 2));
  // If the API returned an array directly
  if (Array.isArray(d)) return d;
  // Common documented wrapper: { objects: [...] }
  if (Array.isArray(d.objects)) return d.objects;
  // Some responses may nest under `data` or `object`
  if (Array.isArray(d.data)) return d.data;
  if (Array.isArray(d.object)) return d.object;
  // If it returned a single object, return as single-element array
  if (d && typeof d === "object" && d.object && !Array.isArray(d.object) && typeof d.object === "object") {
    // maybe resp.data.object { id, ... }; map to [ resp.data.object ]
    return [d.object];
  }
  // nothing recognized
  return null;
}

async function getSchema(key) {
  const url = `${BASE}/objects/${encodeURIComponent(key)}`;
  console.log("GET", url, "locationId=", LOCATION_ID);
  const resp = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Version: API_VERSION,
      Accept: "application/json",
    },
    params: { locationId: LOCATION_ID },
  });
  return resp.data;
}

(async () => {
  try {
    const resp = await listObjectsRaw();
    const all = extractObjectsFromResponse(resp);

    if (!all) {
      console.error("Could not locate object list in response. See response dump above.");
      process.exit(1);
    }

    console.log("Total schemas returned:", all.length);

    // find contact schema candidates
    const contactCandidates = all.filter(
      (o) => {
        if (!o || !o.key) return false;
        return /contact/i.test(o.key) || (o.standard === true && /contact/i.test(String(o.key)));
      }
    );

    if (!contactCandidates.length) {
      console.warn("No obvious contact schemas found. Printing all keys so you can pick:");
      all.forEach((o) => console.log(" -", o.key, "| standard:", o.standard, "| id:", o.id));
      process.exit(0);
    }

    console.log("Contact schema candidates:");
    contactCandidates.forEach((c) =>
      console.log(` - ${c.key} (id: ${c.id}) - primaryDisplay: ${c.primaryDisplayProperty}`)
    );

    // fetch details for the first candidate
    const targetKey = contactCandidates[0].key;
    console.log("\nFetching details for:", targetKey);
    const schema = await getSchema(targetKey);
    console.log("\nObject details:\n", JSON.stringify(schema.object ?? schema, null, 2));

    if (Array.isArray(schema.fields)) {
      console.log("\nFields:");
      schema.fields.forEach((f) =>
        console.log(` • ${f.fieldKey} — name: ${f.name} — type: ${f.dataType}`)
      );
    } else {
      console.warn("No fields array found in schema response; full schema object printed above.");
    }
    // After: if (Array.isArray(schema.fields)) { ... }
    if (Array.isArray(schema.fields)) {
      const standardFields = [];
      const customFields = [];
      schema.fields.forEach((f) => {
        // You may need to adjust this check depending on the API's field structure
        if (
          f.type === "STANDARD_FIELD" ||
          f.dataType === "STANDARD_FIELD" ||
          // Some APIs use dataType for standard fields
          ["TEXT", "EMAIL", "PHONE", "DATE", "NUMERICAL", "RADIO", "SINGLE_OPTIONS", "MULTIPLE_OPTIONS", "LARGE_TEXT"].includes(f.dataType)
        ) {
          standardFields.push(f);
        } else {
          customFields.push(f);
        }
      });

      console.log("\nStandard fields:");
      standardFields.forEach((f) =>
        console.log(` • ${f.fieldKey} — name: ${f.name} — type: ${f.dataType || f.type}`)
      );

      console.log("\nCustom fields:");
      customFields.forEach((f) =>
        console.log(` • ${f.fieldKey} — name: ${f.name} — type: ${f.dataType || f.type}`)
      );
    }
  } catch (err) {
    console.error("Error:", err.response?.status, err.response?.data || err.message);
    process.exit(1);
  }
})();
