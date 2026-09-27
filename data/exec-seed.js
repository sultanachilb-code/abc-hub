/* Executive Report — Verdun Mall, August 2026, as prepared by hand before the report was automated.
   Loaded once as the starting point for VRM 2026-08 (Executive Report feature, docs/FEATURE-exec-report.md). */
export const EXEC_SEED = {
  VRM: { period: "2026-08", data: {
    prepared: "Mall Operations, ABC Operations",
    opened: ["Flormar", "Ipekyol", "Miniso", "Napoletana", "Eleventy", "Adolfo Dominguez", "Steve Madden", "Crepaway", "Noura"].map(name => ({ name })),
    closed: ["Room One", "Converse", "Milord", "Aldo Accessories", "Call It Spring", "Bubs & More", "Zed", "Puma Popup", "Frooza Bozza", "Oakberry", "OVS"].map(name => ({ name })),
    contracts: [["LG", "iPlay", "15/11/2026", "1/12/2026"], ["LG", "The Mozart Lab", "1/11/2026", "15/10/2026"], ["L1", "Simon Perele", "1/2/2027", "30/11/2026"], ["L1", "La Senza", "1/11/2026", "1/11/2026"]]
      .map(([floor, tenant, contract, exp]) => ({ floor, tenant, contract, exp })),
    unitNotes: { "GF-033": "Ex-Puma Pop Up", "GF-037": "Ex-Dolce Farfalla", "L2-029": "Ex-Oil&Gaz", "L3-004": "Core & Shell", "L3-008": "Ex-Antoine Karam", "L3-014": "Core & Shell",
      "L3-015": "Core & Shell", "L3-017": "Beside FZ", "L3-019": "Ex-Les Malins", "L4-005": "Ex-Chatime", "L4-007": "Ex-Dip n Dip", "L4-013": "Ex-Semsom" },
    fitout: { "GF-027": { contract: "1/6/2026", exp: "15/10/2026" }, "L3-037": { contract: "1/1/2027", exp: "1/12/2026" } },
    footfall: [["January", 313706, 349282, 33], ["February", 272735, 279084, -1], ["March", 305941, 206713, -43], ["April", 353324, 220304, -42], ["May", 326869, 335481, 5],
      ["June", 355663, 305185, -20], ["July", 440882, 421854, -4], ["August", 444451, 427264, -1], ["September", "", "", ""], ["October", "", "", ""], ["November", "", "", ""], ["December", "", "", ""]]
      .map(([month, ff25, ff26, sales]) => ({ month, ff25, ff26, s25: "", s26: "", sales })),
    salesTotal: "-10", salesLfl: "-12", declineBase: "12121554", declineTitle: "Verdun Mall",
    decline: [["ZARA", -5377377], ["MASSIMO DUTTI", -628332], ["AIZONE", -567929], ["AISHTI", -472639], ["BOGGI", -437982], ["PULL & BEAR", -359379], ["BERSHKA", -359369], ["OVS", -322808],
      ["PATCHI", -259102], ["MANGO", -251160], ["ZARA HOME", -240039], ["NI ITALIAN JAPANESE CAFE", -237511], ["OYSHO", -222504], ["TOYS R US", -221814]].map(([tenant, drop]) => ({ tenant, drop })),
    groups: [["Verdun Mall LFL", 98404705, 86283151], ["Azadea Verdun Mall", 39366052, 31014264], ["DS", 8505214, 8163695], ["Aishti", 3427320, 2386752], ["Pearl Brands", 1623365.5, 1426866.61],
      ["Retail Group", 2498409, 2487769]].map(([group, s25, s26]) => ({ group, s25, s26 })),
    newt: [["JW PEI", 47, 8479], ["BIMBA Y LOLA", 64, 1346], ["ADOLFO DOMINGUEZ", 140, 2192], ["IPEKYOL", 172, 4082], ["ELEVENTY", 80, 2328], ["FLORMAR", 40, 5404], ["KHAN AL SABOUN", 7, 39695]]
      .map(([tenant, space, ann]) => ({ tenant, space, ann })),
    low: [["HEXA", 30683, 28343, 368], ["POTLOK", 50348, 64721, 506], ["COSMOCITY", 591625, 738172, 564], ["ELEVENTY", 31048, "", 582], ["TAG PRIVE", 61156, 150663, 637],
      ["GRAND CINEMAS", 1643672, 1498661, 656], ["DEFY SPORTS", 855296, 809785, 835], ["SIOM", 54714, 89945, 954], ["BABY SHOP", 332045, 375621, 1158], ["MAX", 845179, 754425, 1171]]
      .map(([tenant, s25, s26, ann]) => ({ tenant, s25, s26, ann })),
    capex: [
      ["Elevators Defensive Strips", 6800, "30/10/26", "Procurement Phase", ""],
      ["CHIP Magnetic Locks for Technical doors (access control)", 40800, "15/10/26", "Procurement Phase", ""],
      ["Closet mirrors for all restrooms & coring for bins", 10200, "30/10/26", "Awaiting Approval", "Awaiting management approval"],
      ["DS Drop Off", 27200, "NA", "Merged", "Merged with Sidewalk project"],
      ["DS Parking lobbies re-designing (-1 Floor)", 68800, "", "Completed", ""],
      ["DS Parking lobbies re-designing (-2 Floor)", 54400, "15/11/26", "BOQ Validation", ""],
      ["Escalators and pillar access to be closed", 6800, "30/09/26", "Execution Phase", ""],
      ["New Bins", 23800, "30/10/26", "Execution Phase", ""],
      ["Facial recognition system enhancement", 108800, "", "Cancelled", "Over budget - rolled over to 2027"],
      ["Flying Santa Claus (rollover in case not done in 2025)", 102000, "", "Cancelled", ""],
      ["Lighting above L3 restaurants", 13600, "", "Cancelled", "Wooden ceiling project"],
      ["L4 Park", 30600, "", "Cancelled", ""],
      ["New Pergola for L4 Park", 10200, "", "Cancelled", ""],
      ["iPlay enhancement", 17000, "", "Cancelled", "Tenancy"],
      ["Wayfinding new design & solution", 81600, "", "Cancelled", "3 flagships - 2027"],
      ["Ni Cafe stairs redesigning", 13600, "", "Cancelled", ""]].map(([project, bgt, deadline, status, comment]) => ({ project, bgt, deadline, status, comment })),
    qcPrevLabel: "May 2026", qcPrev: "74", qcCurLabel: "August 2026", qcCur: "89.7",
    qcNote: "Quality Control results have shown a positive improvement compared to the previous period. Most of the observations were related to cleanliness, which were addressed immediately by the Operations team.\nRegarding the painting related observations, these are currently being addressed as part of the ongoing painting project across the mall."
  } }
};
