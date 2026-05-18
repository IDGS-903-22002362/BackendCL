export function normalizeMxStateForFedEx(value?: string | null): string | undefined {
  if (!value) return undefined;

  const normalized = value
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ");

  const map: Record<string, string> = {
    AGUASCALIENTES: "AG",
    AGS: "AG",
    AG: "AG",

    "BAJA CALIFORNIA": "BC",
    BC: "BC",

    "BAJA CALIFORNIA SUR": "BS",
    BCS: "BS",
    BS: "BS",

    CAMPECHE: "CM",
    CAMP: "CM",
    CM: "CM",

    CHIAPAS: "CS",
    CHIS: "CS",
    CS: "CS",

    CHIHUAHUA: "CH",
    CHIH: "CH",
    CH: "CH",

    "CIUDAD DE MEXICO": "DF",
    CDMX: "DF",
    "MEXICO CITY": "DF",
    DF: "DF",

    COAHUILA: "CO",
    COAH: "CO",
    CO: "CO",

    COLIMA: "CL",
    COL: "CL",
    CL: "CL",

    DURANGO: "DG",
    DGO: "DG",
    DG: "DG",

    GUANAJUATO: "GT",
    GTO: "GT",
    GUA: "GT",
    GT: "GT",

    GUERRERO: "GR",
    GRO: "GR",
    GR: "GR",

    HIDALGO: "HG",
    HGO: "HG",
    HG: "HG",

    JALISCO: "JA",
    JAL: "JA",
    JA: "JA",

    "ESTADO DE MEXICO": "EM",
    EDOMEX: "EM",
    MEXICO: "EM",
    EM: "EM",

    MICHOACAN: "MI",
    "MICHOACAN DE OCAMPO": "MI",
    MICH: "MI",
    MI: "MI",

    MORELOS: "MO",
    MOR: "MO",
    MO: "MO",

    NAYARIT: "NA",
    NAY: "NA",
    NA: "NA",

    "NUEVO LEON": "NL",
    NL: "NL",

    OAXACA: "OA",
    OAX: "OA",
    OA: "OA",

    PUEBLA: "PU",
    PUE: "PU",
    PU: "PU",

    QUERETARO: "QE",
    QRO: "QE",
    QE: "QE",

    "QUINTANA ROO": "QR",
    QROO: "QR",
    QR: "QR",

    "SAN LUIS POTOSI": "SL",
    SLP: "SL",
    SL: "SL",

    SINALOA: "SI",
    SIN: "SI",
    SI: "SI",

    SONORA: "SO",
    SON: "SO",
    SO: "SO",

    TABASCO: "TB",
    TAB: "TB",
    TB: "TB",

    TAMAULIPAS: "TM",
    TAMPS: "TM",
    TM: "TM",

    TLAXCALA: "TL",
    TLAX: "TL",
    TL: "TL",

    VERACRUZ: "VE",
    "VERACRUZ DE IGNACIO DE LA LLAVE": "VE",
    VER: "VE",
    VE: "VE",

    YUCATAN: "YU",
    YUC: "YU",
    YU: "YU",

    ZACATECAS: "ZA",
    ZAC: "ZA",
    ZA: "ZA",
  };

  return map[normalized] ?? value.trim();
}
