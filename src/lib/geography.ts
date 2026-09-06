/**
 * src/lib/geography.ts
 * =====================
 * Authoritative Geographic Coverage Hierarchy for LandAlert-Nexus (SIH26001).
 * Single source of truth for the North Eastern Region of India (NER).
 *
 * Hierarchy:
 * Region (North Eastern Region)
 *   └── State (8 NER States)
 *         └── District (Official Census / Survey of India administrative districts)
 *               └── Risk / Monitored Zone (Telemetry clusters / instrumented slope-monitoring stations)
 */

export interface RegionEntity {
  id: string; // "region-ner"
  name: string;
  code: string;
  country: string;
  centroid: [number, number]; // [lat, lng]
  bounds: [[number, number], [number, number]]; // [[south, west], [north, east]]
  stateIds: string[];
}

export interface StateEntity {
  id: string; // "state-as", "state-ar", etc.
  regionId: string; // "region-ner"
  name: string;
  code: string; // "AS", "AR", "MN", "ML", "MZ", "NL", "SK", "TR"
  capital: string;
  centroid: [number, number]; // [lat, lng]
  bounds: [[number, number], [number, number]];
  districtCount: number;
  districtIds: string[];
}


export interface CityEntity {
  id: string;
  name: string;
  type: "city" | "town" | "locality";
  districtId: string;
  districtName: string;
  stateId: string;
  stateName: string;
  centroid: [number, number]; // [lat, lng]
  zoneIds: number[];
}

export interface DistrictEntity {
  id: string; // "dist-as-dima-hasao"
  stateId: string;
  stateName: string;
  name: string;
  code: string;
  centroid: [number, number]; // [lat, lng]
  zoneIds: number[]; // Active monitored risk zone IDs (can be empty if uninstrumented)
}

export interface MonitoredZoneEntity {
  id: number; // 1 to 15
  districtId: string;
  stateId: string;
  name: string;
  district: string;
  state: string;
  centroid_lat: number;
  centroid_lng: number;
  mean_slope_deg: number;
  population: number;
  monitoring_status: "ACTIVE_TELEMETRY" | "SURVEYED" | "PLANNED";
  default_risk_level: "Low" | "Moderate" | "High" | "Severe" | "UNKNOWN";
  threshold_e_mm: number;
}

// 1. ROOT REGION
export const NORTH_EASTERN_REGION: RegionEntity = {
  id: "region-ner",
  name: "North Eastern Region",
  code: "NER",
  country: "India",
  centroid: [26.1, 93.0],
  bounds: [
    [21.9, 88.0],
    [29.5, 97.5],
  ],
  stateIds: [
    "state-ar",
    "state-as",
    "state-mn",
    "state-ml",
    "state-mz",
    "state-nl",
    "state-sk",
    "state-tr",
  ],
};

// 2. EIGHT NER STATES
export const NER_STATES: Record<string, StateEntity> = {
  "state-ar": {
    id: "state-ar",
    regionId: "region-ner",
    name: "Arunachal Pradesh",
    code: "AR",
    capital: "Itanagar",
    centroid: [27.1, 93.62],
    bounds: [
      [26.6, 91.5],
      [29.5, 97.4],
    ],
    districtCount: 26,
    districtIds: [
      "dist-ar-papum-pare",
      "dist-ar-dibang-valley",
      "dist-ar-tawang",
      "dist-ar-west-kameng",
      "dist-ar-east-kameng",
      "dist-ar-pakke-kessang",
      "dist-ar-lower-subansiri",
      "dist-ar-upper-subansiri",
      "dist-ar-kamle",
      "dist-ar-kra-daadi",
      "dist-ar-kurung-kumey",
      "dist-ar-west-siang",
      "dist-ar-east-siang",
      "dist-ar-siang",
      "dist-ar-upper-siang",
      "dist-ar-lower-siang",
      "dist-ar-lepa-rada",
      "dist-ar-shi-yomi",
      "dist-ar-lower-dibang-valley",
      "dist-ar-lohit",
      "dist-ar-anjaw",
      "dist-ar-namsai",
      "dist-ar-changlang",
      "dist-ar-tirap",
      "dist-ar-longding",
      "dist-ar-itanagar",
    ],
  },
  "state-as": {
    id: "state-as",
    regionId: "region-ner",
    name: "Assam",
    code: "AS",
    capital: "Dispur",
    centroid: [26.2, 92.94],
    bounds: [
      [24.1, 89.7],
      [28.0, 96.0],
    ],
    districtCount: 35,
    districtIds: [
      "dist-as-dima-hasao",
      "dist-as-karbi-anglong",
      "dist-as-west-karbi-anglong",
      "dist-as-cachar",
      "dist-as-hailakandi",
      "dist-as-karimganj",
      "dist-as-kamrup-metropolitan",
      "dist-as-kamrup",
      "dist-as-goalpara",
      "dist-as-bongaigaon",
      "dist-as-barpeta",
      "dist-as-bajali",
      "dist-as-nalbari",
      "dist-as-baksa",
      "dist-as-tamulpur",
      "dist-as-chirang",
      "dist-as-kokrajhar",
      "dist-as-darrang",
      "dist-as-udalguri",
      "dist-as-sonitpur",
      "dist-as-biswanath",
      "dist-as-lakhimpur",
      "dist-as-dhemaji",
      "dist-as-morigaon",
      "dist-as-nagaon",
      "dist-as-hojai",
      "dist-as-golaghat",
      "dist-as-jorhat",
      "dist-as-majuli",
      "dist-as-sivasagar",
      "dist-as-charaideo",
      "dist-as-dibrugarh",
      "dist-as-tinsukia",
      "dist-as-south-salmara",
      "dist-as-dhubri",
    ],
  },
  "state-mn": {
    id: "state-mn",
    regionId: "region-ner",
    name: "Manipur",
    code: "MN",
    capital: "Imphal",
    centroid: [24.8, 93.9],
    bounds: [
      [23.8, 93.0],
      [25.7, 94.8],
    ],
    districtCount: 16,
    districtIds: [
      "dist-mn-tamenglong",
      "dist-mn-noney",
      "dist-mn-imphal-west",
      "dist-mn-imphal-east",
      "dist-mn-bishnupur",
      "dist-mn-thoubal",
      "dist-mn-kakching",
      "dist-mn-ukhrul",
      "dist-mn-kamjong",
      "dist-mn-churachandpur",
      "dist-mn-pherzawl",
      "dist-mn-senapati",
      "dist-mn-kangpokpi",
      "dist-mn-chandel",
      "dist-mn-tengnoupal",
      "dist-mn-jiribam",
    ],
  },
  "state-ml": {
    id: "state-ml",
    regionId: "region-ner",
    name: "Meghalaya",
    code: "ML",
    capital: "Shillong",
    centroid: [25.5, 91.36],
    bounds: [
      [25.0, 89.8],
      [26.1, 92.8],
    ],
    districtCount: 12,
    districtIds: [
      "dist-ml-east-khasi-hills",
      "dist-ml-west-jaintia-hills",
      "dist-ml-east-jaintia-hills",
      "dist-ml-west-khasi-hills",
      "dist-ml-south-west-khasi-hills",
      "dist-ml-eastern-west-khasi-hills",
      "dist-ml-ri-bhoi",
      "dist-ml-east-garo-hills",
      "dist-ml-west-garo-hills",
      "dist-ml-south-garo-hills",
      "dist-ml-north-garo-hills",
      "dist-ml-south-west-garo-hills",
    ],
  },
  "state-mz": {
    id: "state-mz",
    regionId: "region-ner",
    name: "Mizoram",
    code: "MZ",
    capital: "Aizawl",
    centroid: [23.16, 92.9],
    bounds: [
      [21.9, 92.2],
      [24.5, 93.4],
    ],
    districtCount: 11,
    districtIds: [
      "dist-mz-aizawl",
      "dist-mz-lunglei",
      "dist-mz-champhai",
      "dist-mz-kolasib",
      "dist-mz-serchhip",
      "dist-mz-lawngtlai",
      "dist-mz-mamit",
      "dist-mz-saiha",
      "dist-mz-hnahthial",
      "dist-mz-khawzawl",
      "dist-mz-saitual",
    ],
  },
  "state-nl": {
    id: "state-nl",
    regionId: "region-ner",
    name: "Nagaland",
    code: "NL",
    capital: "Kohima",
    centroid: [25.7, 94.1],
    bounds: [
      [25.1, 93.3],
      [27.0, 95.3],
    ],
    districtCount: 16,
    districtIds: [
      "dist-nl-kohima",
      "dist-nl-dimapur",
      "dist-nl-mokokchung",
      "dist-nl-mon",
      "dist-nl-phek",
      "dist-nl-tuensang",
      "dist-nl-wokha",
      "dist-nl-zunheboto",
      "dist-nl-kiphire",
      "dist-nl-longleng",
      "dist-nl-peren",
      "dist-nl-noklak",
      "dist-nl-chumoukedima",
      "dist-nl-niuland",
      "dist-nl-tseminyu",
      "dist-nl-shamator",
    ],
  },
  "state-sk": {
    id: "state-sk",
    regionId: "region-ner",
    name: "Sikkim",
    code: "SK",
    capital: "Gangtok",
    centroid: [27.5, 88.5],
    bounds: [
      [27.0, 88.0],
      [28.1, 88.9],
    ],
    districtCount: 6,
    districtIds: [
      "dist-sk-east-sikkim",
      "dist-sk-mangan",
      "dist-sk-namchi",
      "dist-sk-gyalshing",
      "dist-sk-pakyong",
      "dist-sk-soreng",
    ],
  },
  "state-tr": {
    id: "state-tr",
    regionId: "region-ner",
    name: "Tripura",
    code: "TR",
    capital: "Agartala",
    centroid: [23.94, 91.98],
    bounds: [
      [22.9, 91.1],
      [24.5, 92.4],
    ],
    districtCount: 8,
    districtIds: [
      "dist-tr-dhalai",
      "dist-tr-west-tripura",
      "dist-tr-south-tripura",
      "dist-tr-north-tripura",
      "dist-tr-gomati",
      "dist-tr-khowai",
      "dist-tr-sepahijala",
      "dist-tr-unakoti",
    ],
  },
};

// 3. AUTHORITATIVE DISTRICTS REGISTRY (ALL 130 OFFICIAL NER DISTRICTS)
export const NER_DISTRICTS: Record<string, DistrictEntity> = {
  // Arunachal Pradesh
  "dist-ar-papum-pare": { id: "dist-ar-papum-pare", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Papum Pare", code: "PP", centroid: [27.15, 93.58], zoneIds: [9] },
  "dist-ar-dibang-valley": { id: "dist-ar-dibang-valley", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Dibang Valley", code: "DV", centroid: [28.32, 95.84], zoneIds: [10] },
  "dist-ar-tawang": { id: "dist-ar-tawang", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Tawang", code: "TW", centroid: [27.58, 91.86], zoneIds: [] },
  "dist-ar-west-kameng": { id: "dist-ar-west-kameng", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "West Kameng", code: "WK", centroid: [27.36, 92.41], zoneIds: [] },
  "dist-ar-east-kameng": { id: "dist-ar-east-kameng", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "East Kameng", code: "EK", centroid: [27.32, 93.03], zoneIds: [] },
  "dist-ar-pakke-kessang": { id: "dist-ar-pakke-kessang", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Pakke Kessang", code: "PK", centroid: [27.02, 93.18], zoneIds: [] },
  "dist-ar-lower-subansiri": { id: "dist-ar-lower-subansiri", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Lower Subansiri", code: "LS", centroid: [27.54, 93.83], zoneIds: [] },
  "dist-ar-upper-subansiri": { id: "dist-ar-upper-subansiri", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Upper Subansiri", code: "US", centroid: [28.06, 94.13], zoneIds: [] },
  "dist-ar-kamle": { id: "dist-ar-kamle", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Kamle", code: "KM", centroid: [27.75, 94.02], zoneIds: [] },
  "dist-ar-kra-daadi": { id: "dist-ar-kra-daadi", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Kra Daadi", code: "KD", centroid: [27.91, 93.52], zoneIds: [] },
  "dist-ar-kurung-kumey": { id: "dist-ar-kurung-kumey", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Kurung Kumey", code: "KK", centroid: [28.02, 93.38], zoneIds: [] },
  "dist-ar-west-siang": { id: "dist-ar-west-siang", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "West Siang", code: "WS", centroid: [28.17, 94.80], zoneIds: [] },
  "dist-ar-east-siang": { id: "dist-ar-east-siang", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "East Siang", code: "ES", centroid: [28.07, 95.33], zoneIds: [] },
  "dist-ar-siang": { id: "dist-ar-siang", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Siang", code: "SG", centroid: [28.27, 94.99], zoneIds: [] },
  "dist-ar-upper-siang": { id: "dist-ar-upper-siang", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Upper Siang", code: "UG", centroid: [28.61, 94.94], zoneIds: [] },
  "dist-ar-lower-siang": { id: "dist-ar-lower-siang", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Lower Siang", code: "LG", centroid: [27.85, 94.72], zoneIds: [] },
  "dist-ar-lepa-rada": { id: "dist-ar-lepa-rada", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Lepa Rada", code: "LR", centroid: [27.98, 94.65], zoneIds: [] },
  "dist-ar-shi-yomi": { id: "dist-ar-shi-yomi", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Shi Yomi", code: "SY", centroid: [28.58, 94.32], zoneIds: [] },
  "dist-ar-lower-dibang-valley": { id: "dist-ar-lower-dibang-valley", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Lower Dibang Valley", code: "LD", centroid: [28.15, 95.84], zoneIds: [] },
  "dist-ar-lohit": { id: "dist-ar-lohit", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Lohit", code: "LH", centroid: [27.81, 96.17], zoneIds: [] },
  "dist-ar-anjaw": { id: "dist-ar-anjaw", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Anjaw", code: "AJ", centroid: [28.02, 96.83], zoneIds: [] },
  "dist-ar-namsai": { id: "dist-ar-namsai", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Namsai", code: "NM", centroid: [27.67, 95.87], zoneIds: [] },
  "dist-ar-changlang": { id: "dist-ar-changlang", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Changlang", code: "CH", centroid: [27.13, 95.74], zoneIds: [] },
  "dist-ar-tirap": { id: "dist-ar-tirap", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Tirap", code: "TI", centroid: [27.02, 95.51], zoneIds: [] },
  "dist-ar-longding": { id: "dist-ar-longding", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Longding", code: "LDG", centroid: [26.85, 95.32], zoneIds: [] },
  "dist-ar-itanagar": { id: "dist-ar-itanagar", stateId: "state-ar", stateName: "Arunachal Pradesh", name: "Itanagar Capital Complex", code: "ITC", centroid: [27.09, 93.62], zoneIds: [] },

  // Assam
  "dist-as-dima-hasao": { id: "dist-as-dima-hasao", stateId: "state-as", stateName: "Assam", name: "Dima Hasao", code: "DH", centroid: [25.17, 93.02], zoneIds: [13] },
  "dist-as-karbi-anglong": { id: "dist-as-karbi-anglong", stateId: "state-as", stateName: "Assam", name: "Karbi Anglong", code: "KA", centroid: [25.90, 93.35], zoneIds: [14] },
  "dist-as-west-karbi-anglong": { id: "dist-as-west-karbi-anglong", stateId: "state-as", stateName: "Assam", name: "West Karbi Anglong", code: "WKA", centroid: [25.80, 92.55], zoneIds: [] },
  "dist-as-cachar": { id: "dist-as-cachar", stateId: "state-as", stateName: "Assam", name: "Cachar", code: "CA", centroid: [24.83, 92.80], zoneIds: [] },
  "dist-as-hailakandi": { id: "dist-as-hailakandi", stateId: "state-as", stateName: "Assam", name: "Hailakandi", code: "HA", centroid: [24.68, 92.56], zoneIds: [] },
  "dist-as-karimganj": { id: "dist-as-karimganj", stateId: "state-as", stateName: "Assam", name: "Karimganj", code: "KR", centroid: [24.87, 92.35], zoneIds: [] },
  "dist-as-kamrup-metropolitan": { id: "dist-as-kamrup-metropolitan", stateId: "state-as", stateName: "Assam", name: "Kamrup Metropolitan", code: "KM", centroid: [26.14, 91.77], zoneIds: [] },
  "dist-as-kamrup": { id: "dist-as-kamrup", stateId: "state-as", stateName: "Assam", name: "Kamrup", code: "KU", centroid: [26.31, 91.59], zoneIds: [] },
  "dist-as-goalpara": { id: "dist-as-goalpara", stateId: "state-as", stateName: "Assam", name: "Goalpara", code: "GO", centroid: [26.18, 90.62], zoneIds: [] },
  "dist-as-bongaigaon": { id: "dist-as-bongaigaon", stateId: "state-as", stateName: "Assam", name: "Bongaigaon", code: "BO", centroid: [26.48, 90.56], zoneIds: [] },
  "dist-as-barpeta": { id: "dist-as-barpeta", stateId: "state-as", stateName: "Assam", name: "Barpeta", code: "BA", centroid: [26.32, 91.00], zoneIds: [] },
  "dist-as-bajali": { id: "dist-as-bajali", stateId: "state-as", stateName: "Assam", name: "Bajali", code: "BJ", centroid: [26.49, 91.17], zoneIds: [] },
  "dist-as-nalbari": { id: "dist-as-nalbari", stateId: "state-as", stateName: "Assam", name: "Nalbari", code: "NA", centroid: [26.44, 91.44], zoneIds: [] },
  "dist-as-baksa": { id: "dist-as-baksa", stateId: "state-as", stateName: "Assam", name: "Baksa", code: "BK", centroid: [26.68, 91.59], zoneIds: [] },
  "dist-as-tamulpur": { id: "dist-as-tamulpur", stateId: "state-as", stateName: "Assam", name: "Tamulpur", code: "TP", centroid: [26.63, 91.56], zoneIds: [] },
  "dist-as-chirang": { id: "dist-as-chirang", stateId: "state-as", stateName: "Assam", name: "Chirang", code: "CH", centroid: [26.58, 90.48], zoneIds: [] },
  "dist-as-kokrajhar": { id: "dist-as-kokrajhar", stateId: "state-as", stateName: "Assam", name: "Kokrajhar", code: "KO", centroid: [26.40, 90.27], zoneIds: [] },
  "dist-as-darrang": { id: "dist-as-darrang", stateId: "state-as", stateName: "Assam", name: "Darrang", code: "DA", centroid: [26.45, 92.03], zoneIds: [] },
  "dist-as-udalguri": { id: "dist-as-udalguri", stateId: "state-as", stateName: "Assam", name: "Udalguri", code: "UD", centroid: [26.74, 92.10], zoneIds: [] },
  "dist-as-sonitpur": { id: "dist-as-sonitpur", stateId: "state-as", stateName: "Assam", name: "Sonitpur", code: "SO", centroid: [26.65, 92.79], zoneIds: [] },
  "dist-as-biswanath": { id: "dist-as-biswanath", stateId: "state-as", stateName: "Assam", name: "Biswanath", code: "BS", centroid: [26.73, 93.15], zoneIds: [] },
  "dist-as-lakhimpur": { id: "dist-as-lakhimpur", stateId: "state-as", stateName: "Assam", name: "Lakhimpur", code: "LA", centroid: [27.24, 94.10], zoneIds: [] },
  "dist-as-dhemaji": { id: "dist-as-dhemaji", stateId: "state-as", stateName: "Assam", name: "Dhemaji", code: "DM", centroid: [27.48, 94.58], zoneIds: [] },
  "dist-as-morigaon": { id: "dist-as-morigaon", stateId: "state-as", stateName: "Assam", name: "Morigaon", code: "MO", centroid: [26.25, 92.34], zoneIds: [] },
  "dist-as-nagaon": { id: "dist-as-nagaon", stateId: "state-as", stateName: "Assam", name: "Nagaon", code: "NG", centroid: [26.35, 92.68], zoneIds: [] },
  "dist-as-hojai": { id: "dist-as-hojai", stateId: "state-as", stateName: "Assam", name: "Hojai", code: "HJ", centroid: [26.00, 92.86], zoneIds: [] },
  "dist-as-golaghat": { id: "dist-as-golaghat", stateId: "state-as", stateName: "Assam", name: "Golaghat", code: "GG", centroid: [26.52, 93.97], zoneIds: [] },
  "dist-as-jorhat": { id: "dist-as-jorhat", stateId: "state-as", stateName: "Assam", name: "Jorhat", code: "JO", centroid: [26.75, 94.22], zoneIds: [] },
  "dist-as-majuli": { id: "dist-as-majuli", stateId: "state-as", stateName: "Assam", name: "Majuli", code: "MJ", centroid: [26.95, 94.21], zoneIds: [] },
  "dist-as-sivasagar": { id: "dist-as-sivasagar", stateId: "state-as", stateName: "Assam", name: "Sivasagar", code: "SV", centroid: [26.98, 94.63], zoneIds: [] },
  "dist-as-charaideo": { id: "dist-as-charaideo", stateId: "state-as", stateName: "Assam", name: "Charaideo", code: "CD", centroid: [26.96, 94.94], zoneIds: [] },
  "dist-as-dibrugarh": { id: "dist-as-dibrugarh", stateId: "state-as", stateName: "Assam", name: "Dibrugarh", code: "DI", centroid: [27.47, 94.91], zoneIds: [] },
  "dist-as-tinsukia": { id: "dist-as-tinsukia", stateId: "state-as", stateName: "Assam", name: "Tinsukia", code: "TI", centroid: [27.50, 95.36], zoneIds: [] },
  "dist-as-south-salmara": { id: "dist-as-south-salmara", stateId: "state-as", stateName: "Assam", name: "South Salmara-Mankachar", code: "SS", centroid: [25.71, 89.92], zoneIds: [] },
  "dist-as-dhubri": { id: "dist-as-dhubri", stateId: "state-as", stateName: "Assam", name: "Dhubri", code: "DHU", centroid: [26.02, 89.97], zoneIds: [] },

  // Manipur
  "dist-mn-tamenglong": { id: "dist-mn-tamenglong", stateId: "state-mn", stateName: "Manipur", name: "Tamenglong", code: "TM", centroid: [24.98, 93.49], zoneIds: [1] },
  "dist-mn-noney": { id: "dist-mn-noney", stateId: "state-mn", stateName: "Manipur", name: "Noney", code: "NO", centroid: [24.81, 93.62], zoneIds: [2] },
  "dist-mn-imphal-west": { id: "dist-mn-imphal-west", stateId: "state-mn", stateName: "Manipur", name: "Imphal West", code: "IW", centroid: [24.80, 93.90], zoneIds: [] },
  "dist-mn-imphal-east": { id: "dist-mn-imphal-east", stateId: "state-mn", stateName: "Manipur", name: "Imphal East", code: "IE", centroid: [24.83, 94.02], zoneIds: [] },
  "dist-mn-bishnupur": { id: "dist-mn-bishnupur", stateId: "state-mn", stateName: "Manipur", name: "Bishnupur", code: "BI", centroid: [24.63, 93.76], zoneIds: [] },
  "dist-mn-thoubal": { id: "dist-mn-thoubal", stateId: "state-mn", stateName: "Manipur", name: "Thoubal", code: "TH", centroid: [24.64, 94.01], zoneIds: [] },
  "dist-mn-kakching": { id: "dist-mn-kakching", stateId: "state-mn", stateName: "Manipur", name: "Kakching", code: "KC", centroid: [24.49, 93.98], zoneIds: [] },
  "dist-mn-ukhrul": { id: "dist-mn-ukhrul", stateId: "state-mn", stateName: "Manipur", name: "Ukhrul", code: "UK", centroid: [25.11, 94.36], zoneIds: [] },
  "dist-mn-kamjong": { id: "dist-mn-kamjong", stateId: "state-mn", stateName: "Manipur", name: "Kamjong", code: "KJ", centroid: [24.98, 94.45], zoneIds: [] },
  "dist-mn-churachandpur": { id: "dist-mn-churachandpur", stateId: "state-mn", stateName: "Manipur", name: "Churachandpur", code: "CC", centroid: [24.33, 93.68], zoneIds: [] },
  "dist-mn-pherzawl": { id: "dist-mn-pherzawl", stateId: "state-mn", stateName: "Manipur", name: "Pherzawl", code: "PZ", centroid: [24.26, 93.18], zoneIds: [] },
  "dist-mn-senapati": { id: "dist-mn-senapati", stateId: "state-mn", stateName: "Manipur", name: "Senapati", code: "SE", centroid: [25.27, 94.02], zoneIds: [] },
  "dist-mn-kangpokpi": { id: "dist-mn-kangpokpi", stateId: "state-mn", stateName: "Manipur", name: "Kangpokpi", code: "KP", centroid: [25.15, 93.97], zoneIds: [] },
  "dist-mn-chandel": { id: "dist-mn-chandel", stateId: "state-mn", stateName: "Manipur", name: "Chandel", code: "CD", centroid: [24.33, 94.04], zoneIds: [] },
  "dist-mn-tengnoupal": { id: "dist-mn-tengnoupal", stateId: "state-mn", stateName: "Manipur", name: "Tengnoupal", code: "TN", centroid: [24.40, 94.15], zoneIds: [] },
  "dist-mn-jiribam": { id: "dist-mn-jiribam", stateId: "state-mn", stateName: "Manipur", name: "Jiribam", code: "JB", centroid: [24.80, 93.12], zoneIds: [] },

  // Meghalaya
  "dist-ml-east-khasi-hills": { id: "dist-ml-east-khasi-hills", stateId: "state-ml", stateName: "Meghalaya", name: "East Khasi Hills", code: "EKH", centroid: [25.43, 91.73], zoneIds: [5] },
  "dist-ml-west-jaintia-hills": { id: "dist-ml-west-jaintia-hills", stateId: "state-ml", stateName: "Meghalaya", name: "West Jaintia Hills", code: "WJH", centroid: [25.45, 92.20], zoneIds: [6] },
  "dist-ml-east-jaintia-hills": { id: "dist-ml-east-jaintia-hills", stateId: "state-ml", stateName: "Meghalaya", name: "East Jaintia Hills", code: "EJH", centroid: [25.32, 92.36], zoneIds: [] },
  "dist-ml-west-khasi-hills": { id: "dist-ml-west-khasi-hills", stateId: "state-ml", stateName: "Meghalaya", name: "West Khasi Hills", code: "WKH", centroid: [25.52, 91.26], zoneIds: [] },
  "dist-ml-south-west-khasi-hills": { id: "dist-ml-south-west-khasi-hills", stateId: "state-ml", stateName: "Meghalaya", name: "South West Khasi Hills", code: "SWK", centroid: [25.35, 91.31], zoneIds: [] },
  "dist-ml-eastern-west-khasi-hills": { id: "dist-ml-eastern-west-khasi-hills", stateId: "state-ml", stateName: "Meghalaya", name: "Eastern West Khasi Hills", code: "EWK", centroid: [25.56, 91.52], zoneIds: [] },
  "dist-ml-ri-bhoi": { id: "dist-ml-ri-bhoi", stateId: "state-ml", stateName: "Meghalaya", name: "Ri-Bhoi", code: "RB", centroid: [25.90, 91.88], zoneIds: [] },
  "dist-ml-east-garo-hills": { id: "dist-ml-east-garo-hills", stateId: "state-ml", stateName: "Meghalaya", name: "East Garo Hills", code: "EGH", centroid: [25.60, 90.62], zoneIds: [] },
  "dist-ml-west-garo-hills": { id: "dist-ml-west-garo-hills", stateId: "state-ml", stateName: "Meghalaya", name: "West Garo Hills", code: "WGH", centroid: [25.52, 90.22], zoneIds: [] },
  "dist-ml-south-garo-hills": { id: "dist-ml-south-garo-hills", stateId: "state-ml", stateName: "Meghalaya", name: "South Garo Hills", code: "SGH", centroid: [25.26, 90.63], zoneIds: [] },
  "dist-ml-north-garo-hills": { id: "dist-ml-north-garo-hills", stateId: "state-ml", stateName: "Meghalaya", name: "North Garo Hills", code: "NGH", centroid: [25.92, 90.58], zoneIds: [] },
  "dist-ml-south-west-garo-hills": { id: "dist-ml-south-west-garo-hills", stateId: "state-ml", stateName: "Meghalaya", name: "South West Garo Hills", code: "SWG", centroid: [25.48, 89.96], zoneIds: [] },

  // Mizoram
  "dist-mz-aizawl": { id: "dist-mz-aizawl", stateId: "state-mz", stateName: "Mizoram", name: "Aizawl", code: "AI", centroid: [23.73, 92.72], zoneIds: [3] },
  "dist-mz-lunglei": { id: "dist-mz-lunglei", stateId: "state-mz", stateName: "Mizoram", name: "Lunglei", code: "LU", centroid: [22.89, 92.74], zoneIds: [4] },
  "dist-mz-champhai": { id: "dist-mz-champhai", stateId: "state-mz", stateName: "Mizoram", name: "Champhai", code: "CH", centroid: [23.47, 93.33], zoneIds: [] },
  "dist-mz-kolasib": { id: "dist-mz-kolasib", stateId: "state-mz", stateName: "Mizoram", name: "Kolasib", code: "KO", centroid: [24.23, 92.68], zoneIds: [] },
  "dist-mz-serchhip": { id: "dist-mz-serchhip", stateId: "state-mz", stateName: "Mizoram", name: "Serchhip", code: "SE", centroid: [23.34, 92.85], zoneIds: [] },
  "dist-mz-lawngtlai": { id: "dist-mz-lawngtlai", stateId: "state-mz", stateName: "Mizoram", name: "Lawngtlai", code: "LA", centroid: [22.53, 92.89], zoneIds: [] },
  "dist-mz-mamit": { id: "dist-mz-mamit", stateId: "state-mz", stateName: "Mizoram", name: "Mamit", code: "MA", centroid: [23.93, 92.49], zoneIds: [] },
  "dist-mz-saiha": { id: "dist-mz-saiha", stateId: "state-mz", stateName: "Mizoram", name: "Saiha", code: "SA", centroid: [22.49, 92.98], zoneIds: [] },
  "dist-mz-hnahthial": { id: "dist-mz-hnahthial", stateId: "state-mz", stateName: "Mizoram", name: "Hnahthial", code: "HN", centroid: [22.97, 92.93], zoneIds: [] },
  "dist-mz-khawzawl": { id: "dist-mz-khawzawl", stateId: "state-mz", stateName: "Mizoram", name: "Khawzawl", code: "KZ", centroid: [23.53, 93.18], zoneIds: [] },
  "dist-mz-saitual": { id: "dist-mz-saitual", stateId: "state-mz", stateName: "Mizoram", name: "Saitual", code: "ST", centroid: [23.97, 92.97], zoneIds: [] },

  // Nagaland
  "dist-nl-kohima": { id: "dist-nl-kohima", stateId: "state-nl", stateName: "Nagaland", name: "Kohima", code: "KO", centroid: [25.67, 94.11], zoneIds: [7] },
  "dist-nl-dimapur": { id: "dist-nl-dimapur", stateId: "state-nl", stateName: "Nagaland", name: "Dimapur", code: "DI", centroid: [25.91, 93.73], zoneIds: [8] },
  "dist-nl-mokokchung": { id: "dist-nl-mokokchung", stateId: "state-nl", stateName: "Nagaland", name: "Mokokchung", code: "MK", centroid: [26.33, 94.53], zoneIds: [] },
  "dist-nl-mon": { id: "dist-nl-mon", stateId: "state-nl", stateName: "Nagaland", name: "Mon", code: "MN", centroid: [26.75, 95.05], zoneIds: [] },
  "dist-nl-phek": { id: "dist-nl-phek", stateId: "state-nl", stateName: "Nagaland", name: "Phek", code: "PH", centroid: [25.68, 94.47], zoneIds: [] },
  "dist-nl-tuensang": { id: "dist-nl-tuensang", stateId: "state-nl", stateName: "Nagaland", name: "Tuensang", code: "TU", centroid: [26.28, 94.83], zoneIds: [] },
  "dist-nl-wokha": { id: "dist-nl-wokha", stateId: "state-nl", stateName: "Nagaland", name: "Wokha", code: "WO", centroid: [26.10, 94.26], zoneIds: [] },
  "dist-nl-zunheboto": { id: "dist-nl-zunheboto", stateId: "state-nl", stateName: "Nagaland", name: "Zunheboto", code: "ZU", centroid: [25.97, 94.52], zoneIds: [] },
  "dist-nl-kiphire": { id: "dist-nl-kiphire", stateId: "state-nl", stateName: "Nagaland", name: "Kiphire", code: "KP", centroid: [25.85, 94.78], zoneIds: [] },
  "dist-nl-longleng": { id: "dist-nl-longleng", stateId: "state-nl", stateName: "Nagaland", name: "Longleng", code: "LO", centroid: [26.48, 94.81], zoneIds: [] },
  "dist-nl-peren": { id: "dist-nl-peren", stateId: "state-nl", stateName: "Nagaland", name: "Peren", code: "PE", centroid: [25.52, 93.74], zoneIds: [] },
  "dist-nl-noklak": { id: "dist-nl-noklak", stateId: "state-nl", stateName: "Nagaland", name: "Noklak", code: "NK", centroid: [26.20, 95.00], zoneIds: [] },
  "dist-nl-chumoukedima": { id: "dist-nl-chumoukedima", stateId: "state-nl", stateName: "Nagaland", name: "Chumoukedima", code: "CM", centroid: [25.82, 93.78], zoneIds: [] },
  "dist-nl-niuland": { id: "dist-nl-niuland", stateId: "state-nl", stateName: "Nagaland", name: "Niuland", code: "NU", centroid: [25.96, 93.92], zoneIds: [] },
  "dist-nl-tseminyu": { id: "dist-nl-tseminyu", stateId: "state-nl", stateName: "Nagaland", name: "Tseminyu", code: "TS", centroid: [25.93, 94.21], zoneIds: [] },
  "dist-nl-shamator": { id: "dist-nl-shamator", stateId: "state-nl", stateName: "Nagaland", name: "Shamator", code: "SH", centroid: [26.06, 94.88], zoneIds: [] },

  // Sikkim
  "dist-sk-east-sikkim": { id: "dist-sk-east-sikkim", stateId: "state-sk", stateName: "Sikkim", name: "East Sikkim (Gangtok)", code: "ES", centroid: [27.33, 88.61], zoneIds: [11] },
  "dist-sk-mangan": { id: "dist-sk-mangan", stateId: "state-sk", stateName: "Sikkim", name: "Mangan (North Sikkim)", code: "MN", centroid: [27.51, 88.53], zoneIds: [12] },
  "dist-sk-namchi": { id: "dist-sk-namchi", stateId: "state-sk", stateName: "Sikkim", name: "Namchi (South Sikkim)", code: "NM", centroid: [27.17, 88.36], zoneIds: [] },
  "dist-sk-gyalshing": { id: "dist-sk-gyalshing", stateId: "state-sk", stateName: "Sikkim", name: "Gyalshing (West Sikkim)", code: "GY", centroid: [27.28, 88.24], zoneIds: [] },
  "dist-sk-pakyong": { id: "dist-sk-pakyong", stateId: "state-sk", stateName: "Sikkim", name: "Pakyong", code: "PK", centroid: [27.24, 88.59], zoneIds: [] },
  "dist-sk-soreng": { id: "dist-sk-soreng", stateId: "state-sk", stateName: "Sikkim", name: "Soreng", code: "SR", centroid: [27.16, 88.20], zoneIds: [] },

  // Tripura
  "dist-tr-dhalai": { id: "dist-tr-dhalai", stateId: "state-tr", stateName: "Tripura", name: "Dhalai", code: "DH", centroid: [23.92, 91.85], zoneIds: [15] },
  "dist-tr-west-tripura": { id: "dist-tr-west-tripura", stateId: "state-tr", stateName: "Tripura", name: "West Tripura", code: "WT", centroid: [23.83, 91.28], zoneIds: [] },
  "dist-tr-south-tripura": { id: "dist-tr-south-tripura", stateId: "state-tr", stateName: "Tripura", name: "South Tripura", code: "ST", centroid: [23.23, 91.46], zoneIds: [] },
  "dist-tr-north-tripura": { id: "dist-tr-north-tripura", stateId: "state-tr", stateName: "Tripura", name: "North Tripura", code: "NT", centroid: [24.28, 92.16], zoneIds: [] },
  "dist-tr-gomati": { id: "dist-tr-gomati", stateId: "state-tr", stateName: "Tripura", name: "Gomati", code: "GM", centroid: [23.53, 91.68], zoneIds: [] },
  "dist-tr-khowai": { id: "dist-tr-khowai", stateId: "state-tr", stateName: "Tripura", name: "Khowai", code: "KH", centroid: [24.06, 91.60], zoneIds: [] },
  "dist-tr-sepahijala": { id: "dist-tr-sepahijala", stateId: "state-tr", stateName: "Tripura", name: "Sepahijala", code: "SP", centroid: [23.69, 91.32], zoneIds: [] },
  "dist-tr-unakoti": { id: "dist-tr-unakoti", stateId: "state-tr", stateName: "Tripura", name: "Unakoti", code: "UK", centroid: [24.32, 92.02], zoneIds: [] },
};


// 3.B. EXHAUSTIVE CITIES, TOWNS & LOCALITIES ACROSS ALL 8 NER STATES
export const NER_CITIES: CityEntity[] = [
  {
    "id": "city-gangtok-sk",
    "name": "Gangtok",
    "type": "city",
    "districtId": "dist-sk-east-sikkim",
    "districtName": "East Sikkim (Gangtok)",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [27.3389, 88.6065],
    "zoneIds": [11]
  },
  {
    "id": "city-singtam-sk",
    "name": "Singtam",
    "type": "town",
    "districtId": "dist-sk-east-sikkim",
    "districtName": "East Sikkim (Gangtok)",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [27.23, 88.50],
    "zoneIds": [11]
  },
  {
    "id": "city-rangpo-sk",
    "name": "Rangpo",
    "type": "town",
    "districtId": "dist-sk-east-sikkim",
    "districtName": "East Sikkim (Gangtok)",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [27.18, 88.53],
    "zoneIds": [11]
  },
  {
    "id": "city-namchi-sk",
    "name": "Namchi",
    "type": "city",
    "districtId": "dist-sk-south-sikkim",
    "districtName": "Namchi (South Sikkim)",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [27.1654, 88.3582],
    "zoneIds": []
  },
  {
    "id": "city-mangan-sk",
    "name": "Mangan",
    "type": "city",
    "districtId": "dist-sk-north-sikkim",
    "districtName": "Mangan (North Sikkim)",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [27.5167, 88.5333],
    "zoneIds": []
  },

  {
    "id": "city-itanagar-ar-papum-pare",
    "name": "Itanagar",
    "type": "city",
    "districtId": "dist-ar-papum-pare",
    "districtName": "Papum Pare",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.0844,
      93.6053
    ],
    "zoneIds": [
      9
    ]
  },
  {
    "id": "city-naharlagun-ar-papum-pare",
    "name": "Naharlagun",
    "type": "city",
    "districtId": "dist-ar-papum-pare",
    "districtName": "Papum Pare",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.1,
      93.68
    ],
    "zoneIds": [
      9
    ]
  },
  {
    "id": "city-doimukh-ar-papum-pare",
    "name": "Doimukh",
    "type": "town",
    "districtId": "dist-ar-papum-pare",
    "districtName": "Papum Pare",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.14,
      93.75
    ],
    "zoneIds": [
      9
    ]
  },
  {
    "id": "city-yupia-ar-papum-pare",
    "name": "Yupia",
    "type": "town",
    "districtId": "dist-ar-papum-pare",
    "districtName": "Papum Pare",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.15,
      93.7
    ],
    "zoneIds": [
      9
    ]
  },
  {
    "id": "city-nirjuli-ar-papum-pare",
    "name": "Nirjuli",
    "type": "town",
    "districtId": "dist-ar-papum-pare",
    "districtName": "Papum Pare",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.12,
      93.73
    ],
    "zoneIds": [
      9
    ]
  },
  {
    "id": "city-banderdewa-ar-papum-pare",
    "name": "Banderdewa",
    "type": "town",
    "districtId": "dist-ar-papum-pare",
    "districtName": "Papum Pare",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.12,
      93.82
    ],
    "zoneIds": [
      9
    ]
  },
  {
    "id": "city-anini-ar-dibang-valley",
    "name": "Anini",
    "type": "city",
    "districtId": "dist-ar-dibang-valley",
    "districtName": "Dibang Valley",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.8,
      95.9
    ],
    "zoneIds": [
      10
    ]
  },
  {
    "id": "city-etalin-ar-dibang-valley",
    "name": "Etalin",
    "type": "town",
    "districtId": "dist-ar-dibang-valley",
    "districtName": "Dibang Valley",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.62,
      95.85
    ],
    "zoneIds": [
      10
    ]
  },
  {
    "id": "city-tawang-ar-tawang",
    "name": "Tawang",
    "type": "city",
    "districtId": "dist-ar-tawang",
    "districtName": "Tawang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.5861,
      91.8594
    ],
    "zoneIds": []
  },
  {
    "id": "city-jang-ar-tawang",
    "name": "Jang",
    "type": "town",
    "districtId": "dist-ar-tawang",
    "districtName": "Tawang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.58,
      92.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-lumla-ar-tawang",
    "name": "Lumla",
    "type": "town",
    "districtId": "dist-ar-tawang",
    "districtName": "Tawang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.53,
      91.72
    ],
    "zoneIds": []
  },
  {
    "id": "city-zemithang-ar-tawang",
    "name": "Zemithang",
    "type": "town",
    "districtId": "dist-ar-tawang",
    "districtName": "Tawang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.7,
      91.71
    ],
    "zoneIds": []
  },
  {
    "id": "city-mukto-ar-tawang",
    "name": "Mukto",
    "type": "town",
    "districtId": "dist-ar-tawang",
    "districtName": "Tawang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.55,
      91.95
    ],
    "zoneIds": []
  },
  {
    "id": "city-bomdila-ar-west-kameng",
    "name": "Bomdila",
    "type": "city",
    "districtId": "dist-ar-west-kameng",
    "districtName": "West Kameng",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.2645,
      92.4159
    ],
    "zoneIds": []
  },
  {
    "id": "city-rupa-ar-west-kameng",
    "name": "Rupa",
    "type": "town",
    "districtId": "dist-ar-west-kameng",
    "districtName": "West Kameng",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.2,
      92.4
    ],
    "zoneIds": []
  },
  {
    "id": "city-bhalukpong-ar-west-kameng",
    "name": "Bhalukpong",
    "type": "town",
    "districtId": "dist-ar-west-kameng",
    "districtName": "West Kameng",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.01,
      92.65
    ],
    "zoneIds": []
  },
  {
    "id": "city-dirang-ar-west-kameng",
    "name": "Dirang",
    "type": "town",
    "districtId": "dist-ar-west-kameng",
    "districtName": "West Kameng",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.35,
      92.23
    ],
    "zoneIds": []
  },
  {
    "id": "city-singchung-ar-west-kameng",
    "name": "Singchung",
    "type": "town",
    "districtId": "dist-ar-west-kameng",
    "districtName": "West Kameng",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.15,
      92.48
    ],
    "zoneIds": []
  },
  {
    "id": "city-seppa-ar-east-kameng",
    "name": "Seppa",
    "type": "city",
    "districtId": "dist-ar-east-kameng",
    "districtName": "East Kameng",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.35,
      93.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-chayang-tajo-ar-east-kameng",
    "name": "Chayang Tajo",
    "type": "town",
    "districtId": "dist-ar-east-kameng",
    "districtName": "East Kameng",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.58,
      93.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-bana-ar-east-kameng",
    "name": "Bana",
    "type": "town",
    "districtId": "dist-ar-east-kameng",
    "districtName": "East Kameng",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.25,
      92.95
    ],
    "zoneIds": []
  },
  {
    "id": "city-lemmi-ar-pakke-kessang",
    "name": "Lemmi",
    "type": "town",
    "districtId": "dist-ar-pakke-kessang",
    "districtName": "Pakke Kessang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.15,
      93.18
    ],
    "zoneIds": []
  },
  {
    "id": "city-seijosa-ar-pakke-kessang",
    "name": "Seijosa",
    "type": "town",
    "districtId": "dist-ar-pakke-kessang",
    "districtName": "Pakke Kessang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      26.95,
      92.98
    ],
    "zoneIds": []
  },
  {
    "id": "city-pakke-kessang-ar-pakke-kessang",
    "name": "Pakke Kessang",
    "type": "city",
    "districtId": "dist-ar-pakke-kessang",
    "districtName": "Pakke Kessang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.2,
      93.2
    ],
    "zoneIds": []
  },
  {
    "id": "city-ziro-ar-lower-subansiri",
    "name": "Ziro",
    "type": "city",
    "districtId": "dist-ar-lower-subansiri",
    "districtName": "Lower Subansiri",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.595,
      93.8347
    ],
    "zoneIds": []
  },
  {
    "id": "city-hapoli-ar-lower-subansiri",
    "name": "Hapoli",
    "type": "town",
    "districtId": "dist-ar-lower-subansiri",
    "districtName": "Lower Subansiri",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.58,
      93.83
    ],
    "zoneIds": []
  },
  {
    "id": "city-yachuli-ar-lower-subansiri",
    "name": "Yachuli",
    "type": "town",
    "districtId": "dist-ar-lower-subansiri",
    "districtName": "Lower Subansiri",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.48,
      93.78
    ],
    "zoneIds": []
  },
  {
    "id": "city-old-ziro-ar-lower-subansiri",
    "name": "Old Ziro",
    "type": "locality",
    "districtId": "dist-ar-lower-subansiri",
    "districtName": "Lower Subansiri",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.6,
      93.85
    ],
    "zoneIds": []
  },
  {
    "id": "city-daporijo-ar-upper-subansiri",
    "name": "Daporijo",
    "type": "city",
    "districtId": "dist-ar-upper-subansiri",
    "districtName": "Upper Subansiri",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.98,
      94.22
    ],
    "zoneIds": []
  },
  {
    "id": "city-dumporijo-ar-upper-subansiri",
    "name": "Dumporijo",
    "type": "town",
    "districtId": "dist-ar-upper-subansiri",
    "districtName": "Upper Subansiri",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.98,
      94.28
    ],
    "zoneIds": []
  },
  {
    "id": "city-nacho-ar-upper-subansiri",
    "name": "Nacho",
    "type": "town",
    "districtId": "dist-ar-upper-subansiri",
    "districtName": "Upper Subansiri",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.25,
      93.95
    ],
    "zoneIds": []
  },
  {
    "id": "city-raga-ar-kamle",
    "name": "Raga",
    "type": "city",
    "districtId": "dist-ar-kamle",
    "districtName": "Kamle",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.78,
      94.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-dollungmukh-ar-kamle",
    "name": "Dollungmukh",
    "type": "town",
    "districtId": "dist-ar-kamle",
    "districtName": "Kamle",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.47,
      94.18
    ],
    "zoneIds": []
  },
  {
    "id": "city-jamin-ar-kra-daadi",
    "name": "Jamin",
    "type": "town",
    "districtId": "dist-ar-kra-daadi",
    "districtName": "Kra Daadi",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.85,
      93.55
    ],
    "zoneIds": []
  },
  {
    "id": "city-palin-ar-kra-daadi",
    "name": "Palin",
    "type": "city",
    "districtId": "dist-ar-kra-daadi",
    "districtName": "Kra Daadi",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.72,
      93.6
    ],
    "zoneIds": []
  },
  {
    "id": "city-koloriang-ar-kurung-kumey",
    "name": "Koloriang",
    "type": "city",
    "districtId": "dist-ar-kurung-kumey",
    "districtName": "Kurung Kumey",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.9,
      93.45
    ],
    "zoneIds": []
  },
  {
    "id": "city-nyapin-ar-kurung-kumey",
    "name": "Nyapin",
    "type": "town",
    "districtId": "dist-ar-kurung-kumey",
    "districtName": "Kurung Kumey",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.65,
      93.42
    ],
    "zoneIds": []
  },
  {
    "id": "city-sarli-ar-kurung-kumey",
    "name": "Sarli",
    "type": "town",
    "districtId": "dist-ar-kurung-kumey",
    "districtName": "Kurung Kumey",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.05,
      93.25
    ],
    "zoneIds": []
  },
  {
    "id": "city-aalo-ar-west-siang",
    "name": "Aalo",
    "type": "city",
    "districtId": "dist-ar-west-siang",
    "districtName": "West Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.17,
      94.8
    ],
    "zoneIds": []
  },
  {
    "id": "city-basar-ar-west-siang",
    "name": "Basar",
    "type": "town",
    "districtId": "dist-ar-west-siang",
    "districtName": "West Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.98,
      94.67
    ],
    "zoneIds": []
  },
  {
    "id": "city-likabali-ar-west-siang",
    "name": "Likabali",
    "type": "town",
    "districtId": "dist-ar-west-siang",
    "districtName": "West Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.65,
      94.67
    ],
    "zoneIds": []
  },
  {
    "id": "city-pasighat-ar-east-siang",
    "name": "Pasighat",
    "type": "city",
    "districtId": "dist-ar-east-siang",
    "districtName": "East Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.0664,
      95.3267
    ],
    "zoneIds": []
  },
  {
    "id": "city-ruksin-ar-east-siang",
    "name": "Ruksin",
    "type": "town",
    "districtId": "dist-ar-east-siang",
    "districtName": "East Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.83,
      95.22
    ],
    "zoneIds": []
  },
  {
    "id": "city-mebo-ar-east-siang",
    "name": "Mebo",
    "type": "town",
    "districtId": "dist-ar-east-siang",
    "districtName": "East Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.18,
      95.42
    ],
    "zoneIds": []
  },
  {
    "id": "city-sille-oyan-ar-east-siang",
    "name": "Sille-Oyan",
    "type": "town",
    "districtId": "dist-ar-east-siang",
    "districtName": "East Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.95,
      95.28
    ],
    "zoneIds": []
  },
  {
    "id": "city-pangin-ar-siang",
    "name": "Pangin",
    "type": "city",
    "districtId": "dist-ar-siang",
    "districtName": "Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.2,
      94.98
    ],
    "zoneIds": []
  },
  {
    "id": "city-boleng-ar-siang",
    "name": "Boleng",
    "type": "town",
    "districtId": "dist-ar-siang",
    "districtName": "Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.33,
      95.03
    ],
    "zoneIds": []
  },
  {
    "id": "city-kaying-ar-siang",
    "name": "Kaying",
    "type": "town",
    "districtId": "dist-ar-siang",
    "districtName": "Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.25,
      94.8
    ],
    "zoneIds": []
  },
  {
    "id": "city-yingkiong-ar-upper-siang",
    "name": "Yingkiong",
    "type": "city",
    "districtId": "dist-ar-upper-siang",
    "districtName": "Upper Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.62,
      94.92
    ],
    "zoneIds": []
  },
  {
    "id": "city-tuting-ar-upper-siang",
    "name": "Tuting",
    "type": "town",
    "districtId": "dist-ar-upper-siang",
    "districtName": "Upper Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.98,
      94.9
    ],
    "zoneIds": []
  },
  {
    "id": "city-geku-ar-upper-siang",
    "name": "Geku",
    "type": "town",
    "districtId": "dist-ar-upper-siang",
    "districtName": "Upper Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.45,
      95.08
    ],
    "zoneIds": []
  },
  {
    "id": "city-likabali-ar-lower-siang",
    "name": "Likabali",
    "type": "city",
    "districtId": "dist-ar-lower-siang",
    "districtName": "Lower Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.65,
      94.67
    ],
    "zoneIds": []
  },
  {
    "id": "city-nari-ar-lower-siang",
    "name": "Nari",
    "type": "town",
    "districtId": "dist-ar-lower-siang",
    "districtName": "Lower Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.75,
      95.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-kora-ar-lower-siang",
    "name": "Kora",
    "type": "town",
    "districtId": "dist-ar-lower-siang",
    "districtName": "Lower Siang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.78,
      95.12
    ],
    "zoneIds": []
  },
  {
    "id": "city-basar-ar-lepa-rada",
    "name": "Basar",
    "type": "city",
    "districtId": "dist-ar-lepa-rada",
    "districtName": "Lepa Rada",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.98,
      94.67
    ],
    "zoneIds": []
  },
  {
    "id": "city-tirbin-ar-lepa-rada",
    "name": "Tirbin",
    "type": "town",
    "districtId": "dist-ar-lepa-rada",
    "districtName": "Lepa Rada",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.05,
      94.62
    ],
    "zoneIds": []
  },
  {
    "id": "city-daring-ar-lepa-rada",
    "name": "Daring",
    "type": "town",
    "districtId": "dist-ar-lepa-rada",
    "districtName": "Lepa Rada",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.9,
      94.75
    ],
    "zoneIds": []
  },
  {
    "id": "city-tato-ar-shi-yomi",
    "name": "Tato",
    "type": "city",
    "districtId": "dist-ar-shi-yomi",
    "districtName": "Shi Yomi",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.53,
      94.37
    ],
    "zoneIds": []
  },
  {
    "id": "city-mechuka-ar-shi-yomi",
    "name": "Mechuka",
    "type": "town",
    "districtId": "dist-ar-shi-yomi",
    "districtName": "Shi Yomi",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.6,
      94.13
    ],
    "zoneIds": []
  },
  {
    "id": "city-monigong-ar-shi-yomi",
    "name": "Monigong",
    "type": "town",
    "districtId": "dist-ar-shi-yomi",
    "districtName": "Shi Yomi",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.75,
      94.3
    ],
    "zoneIds": []
  },
  {
    "id": "city-roing-ar-lower-dibang-valley",
    "name": "Roing",
    "type": "city",
    "districtId": "dist-ar-lower-dibang-valley",
    "districtName": "Lower Dibang Valley",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.14,
      95.83
    ],
    "zoneIds": []
  },
  {
    "id": "city-dambuk-ar-lower-dibang-valley",
    "name": "Dambuk",
    "type": "town",
    "districtId": "dist-ar-lower-dibang-valley",
    "districtName": "Lower Dibang Valley",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.08,
      95.57
    ],
    "zoneIds": []
  },
  {
    "id": "city-tezu-ar-lohit",
    "name": "Tezu",
    "type": "city",
    "districtId": "dist-ar-lohit",
    "districtName": "Lohit",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.92,
      96.16
    ],
    "zoneIds": []
  },
  {
    "id": "city-sunpura-ar-lohit",
    "name": "Sunpura",
    "type": "town",
    "districtId": "dist-ar-lohit",
    "districtName": "Lohit",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.85,
      95.95
    ],
    "zoneIds": []
  },
  {
    "id": "city-wakro-ar-lohit",
    "name": "Wakro",
    "type": "town",
    "districtId": "dist-ar-lohit",
    "districtName": "Lohit",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.78,
      96.35
    ],
    "zoneIds": []
  },
  {
    "id": "city-hawai-ar-anjaw",
    "name": "Hawai",
    "type": "city",
    "districtId": "dist-ar-anjaw",
    "districtName": "Anjaw",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.88,
      96.8
    ],
    "zoneIds": []
  },
  {
    "id": "city-hayuliang-ar-anjaw",
    "name": "Hayuliang",
    "type": "town",
    "districtId": "dist-ar-anjaw",
    "districtName": "Anjaw",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.08,
      96.55
    ],
    "zoneIds": []
  },
  {
    "id": "city-kibithu-ar-anjaw",
    "name": "Kibithu",
    "type": "locality",
    "districtId": "dist-ar-anjaw",
    "districtName": "Anjaw",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.28,
      97.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-walong-ar-anjaw",
    "name": "Walong",
    "type": "locality",
    "districtId": "dist-ar-anjaw",
    "districtName": "Anjaw",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      28.12,
      97.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-namsai-ar-namsai",
    "name": "Namsai",
    "type": "city",
    "districtId": "dist-ar-namsai",
    "districtName": "Namsai",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.67,
      95.87
    ],
    "zoneIds": []
  },
  {
    "id": "city-chowkham-ar-namsai",
    "name": "Chowkham",
    "type": "town",
    "districtId": "dist-ar-namsai",
    "districtName": "Namsai",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.75,
      96.0
    ],
    "zoneIds": []
  },
  {
    "id": "city-mahadevpur-ar-namsai",
    "name": "Mahadevpur",
    "type": "town",
    "districtId": "dist-ar-namsai",
    "districtName": "Namsai",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.6,
      95.8
    ],
    "zoneIds": []
  },
  {
    "id": "city-changlang-ar-changlang",
    "name": "Changlang",
    "type": "city",
    "districtId": "dist-ar-changlang",
    "districtName": "Changlang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.15,
      95.73
    ],
    "zoneIds": []
  },
  {
    "id": "city-miao-ar-changlang",
    "name": "Miao",
    "type": "town",
    "districtId": "dist-ar-changlang",
    "districtName": "Changlang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.48,
      96.2
    ],
    "zoneIds": []
  },
  {
    "id": "city-jairampur-ar-changlang",
    "name": "Jairampur",
    "type": "town",
    "districtId": "dist-ar-changlang",
    "districtName": "Changlang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.33,
      96.03
    ],
    "zoneIds": []
  },
  {
    "id": "city-bordumsa-ar-changlang",
    "name": "Bordumsa",
    "type": "town",
    "districtId": "dist-ar-changlang",
    "districtName": "Changlang",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.53,
      95.87
    ],
    "zoneIds": []
  },
  {
    "id": "city-khonsa-ar-tirap",
    "name": "Khonsa",
    "type": "city",
    "districtId": "dist-ar-tirap",
    "districtName": "Tirap",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      26.98,
      95.5
    ],
    "zoneIds": []
  },
  {
    "id": "city-deomali-ar-tirap",
    "name": "Deomali",
    "type": "town",
    "districtId": "dist-ar-tirap",
    "districtName": "Tirap",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.15,
      95.48
    ],
    "zoneIds": []
  },
  {
    "id": "city-longding-ar-longding",
    "name": "Longding",
    "type": "city",
    "districtId": "dist-ar-longding",
    "districtName": "Longding",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      26.85,
      95.25
    ],
    "zoneIds": []
  },
  {
    "id": "city-kanubari-ar-longding",
    "name": "Kanubari",
    "type": "town",
    "districtId": "dist-ar-longding",
    "districtName": "Longding",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      26.95,
      95.12
    ],
    "zoneIds": []
  },
  {
    "id": "city-pangchao-ar-longding",
    "name": "Pangchao",
    "type": "town",
    "districtId": "dist-ar-longding",
    "districtName": "Longding",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      26.8,
      95.3
    ],
    "zoneIds": []
  },
  {
    "id": "city-itanagar-capital-complex-ar-itanagar",
    "name": "Itanagar Capital Complex",
    "type": "town",
    "districtId": "dist-ar-itanagar",
    "districtName": "Itanagar Capital Complex",
    "stateId": "state-ar",
    "stateName": "Arunachal Pradesh",
    "centroid": [
      27.09,
      93.62
    ],
    "zoneIds": []
  },
  {
    "id": "city-haflong-as-dima-hasao",
    "name": "Haflong",
    "type": "city",
    "districtId": "dist-as-dima-hasao",
    "districtName": "Dima Hasao",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.1764,
      93.0169
    ],
    "zoneIds": [
      13
    ]
  },
  {
    "id": "city-jatinga-as-dima-hasao",
    "name": "Jatinga",
    "type": "locality",
    "districtId": "dist-as-dima-hasao",
    "districtName": "Dima Hasao",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.12,
      93.04
    ],
    "zoneIds": [
      13
    ]
  },
  {
    "id": "city-mahur-as-dima-hasao",
    "name": "Mahur",
    "type": "town",
    "districtId": "dist-as-dima-hasao",
    "districtName": "Dima Hasao",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.18,
      93.12
    ],
    "zoneIds": [
      13
    ]
  },
  {
    "id": "city-maibang-as-dima-hasao",
    "name": "Maibang",
    "type": "town",
    "districtId": "dist-as-dima-hasao",
    "districtName": "Dima Hasao",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.3,
      93.16
    ],
    "zoneIds": [
      13
    ]
  },
  {
    "id": "city-umrangso-as-dima-hasao",
    "name": "Umrangso",
    "type": "town",
    "districtId": "dist-as-dima-hasao",
    "districtName": "Dima Hasao",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.51,
      92.78
    ],
    "zoneIds": [
      13
    ]
  },
  {
    "id": "city-harangajao-as-dima-hasao",
    "name": "Harangajao",
    "type": "town",
    "districtId": "dist-as-dima-hasao",
    "districtName": "Dima Hasao",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.11,
      92.86
    ],
    "zoneIds": [
      13
    ]
  },
  {
    "id": "city-diphu-as-karbi-anglong",
    "name": "Diphu",
    "type": "city",
    "districtId": "dist-as-karbi-anglong",
    "districtName": "Karbi Anglong",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.8454,
      93.4357
    ],
    "zoneIds": [
      14
    ]
  },
  {
    "id": "city-bokajan-as-karbi-anglong",
    "name": "Bokajan",
    "type": "town",
    "districtId": "dist-as-karbi-anglong",
    "districtName": "Karbi Anglong",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.02,
      93.78
    ],
    "zoneIds": [
      14
    ]
  },
  {
    "id": "city-howraghat-as-karbi-anglong",
    "name": "Howraghat",
    "type": "town",
    "districtId": "dist-as-karbi-anglong",
    "districtName": "Karbi Anglong",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.03,
      93.03
    ],
    "zoneIds": [
      14
    ]
  },
  {
    "id": "city-dokmoka-as-karbi-anglong",
    "name": "Dokmoka",
    "type": "town",
    "districtId": "dist-as-karbi-anglong",
    "districtName": "Karbi Anglong",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.2,
      93.15
    ],
    "zoneIds": [
      14
    ]
  },
  {
    "id": "city-manja-as-karbi-anglong",
    "name": "Manja",
    "type": "town",
    "districtId": "dist-as-karbi-anglong",
    "districtName": "Karbi Anglong",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.9,
      93.42
    ],
    "zoneIds": [
      14
    ]
  },
  {
    "id": "city-hamren-as-west-karbi-anglong",
    "name": "Hamren",
    "type": "town",
    "districtId": "dist-as-west-karbi-anglong",
    "districtName": "West Karbi Anglong",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.86,
      92.58
    ],
    "zoneIds": []
  },
  {
    "id": "city-baithalangso-as-west-karbi-anglong",
    "name": "Baithalangso",
    "type": "town",
    "districtId": "dist-as-west-karbi-anglong",
    "districtName": "West Karbi Anglong",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.93,
      92.55
    ],
    "zoneIds": []
  },
  {
    "id": "city-kheroni-as-west-karbi-anglong",
    "name": "Kheroni",
    "type": "town",
    "districtId": "dist-as-west-karbi-anglong",
    "districtName": "West Karbi Anglong",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.75,
      92.88
    ],
    "zoneIds": []
  },
  {
    "id": "city-silchar-as-cachar",
    "name": "Silchar",
    "type": "city",
    "districtId": "dist-as-cachar",
    "districtName": "Cachar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.8333,
      92.7789
    ],
    "zoneIds": []
  },
  {
    "id": "city-lakhipur-as-cachar",
    "name": "Lakhipur",
    "type": "town",
    "districtId": "dist-as-cachar",
    "districtName": "Cachar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.796,
      93.007
    ],
    "zoneIds": []
  },
  {
    "id": "city-sonai-as-cachar",
    "name": "Sonai",
    "type": "town",
    "districtId": "dist-as-cachar",
    "districtName": "Cachar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.72,
      92.89
    ],
    "zoneIds": []
  },
  {
    "id": "city-dholai-as-cachar",
    "name": "Dholai",
    "type": "town",
    "districtId": "dist-as-cachar",
    "districtName": "Cachar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.6,
      92.84
    ],
    "zoneIds": []
  },
  {
    "id": "city-hailakandi-as-hailakandi",
    "name": "Hailakandi",
    "type": "city",
    "districtId": "dist-as-hailakandi",
    "districtName": "Hailakandi",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.68,
      92.56
    ],
    "zoneIds": []
  },
  {
    "id": "city-lala-as-hailakandi",
    "name": "Lala",
    "type": "town",
    "districtId": "dist-as-hailakandi",
    "districtName": "Hailakandi",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.55,
      92.6
    ],
    "zoneIds": []
  },
  {
    "id": "city-katlicherra-as-hailakandi",
    "name": "Katlicherra",
    "type": "town",
    "districtId": "dist-as-hailakandi",
    "districtName": "Hailakandi",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.43,
      92.58
    ],
    "zoneIds": []
  },
  {
    "id": "city-algapur-as-hailakandi",
    "name": "Algapur",
    "type": "town",
    "districtId": "dist-as-hailakandi",
    "districtName": "Hailakandi",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.78,
      92.6
    ],
    "zoneIds": []
  },
  {
    "id": "city-karimganj-as-karimganj",
    "name": "Karimganj",
    "type": "city",
    "districtId": "dist-as-karimganj",
    "districtName": "Karimganj",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.87,
      92.35
    ],
    "zoneIds": []
  },
  {
    "id": "city-badarpur-as-karimganj",
    "name": "Badarpur",
    "type": "town",
    "districtId": "dist-as-karimganj",
    "districtName": "Karimganj",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.9,
      92.55
    ],
    "zoneIds": []
  },
  {
    "id": "city-ramkrishna-nagar-as-karimganj",
    "name": "Ramkrishna Nagar",
    "type": "town",
    "districtId": "dist-as-karimganj",
    "districtName": "Karimganj",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.58,
      92.52
    ],
    "zoneIds": []
  },
  {
    "id": "city-patharkandi-as-karimganj",
    "name": "Patharkandi",
    "type": "town",
    "districtId": "dist-as-karimganj",
    "districtName": "Karimganj",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      24.62,
      92.33
    ],
    "zoneIds": []
  },
  {
    "id": "city-guwahati-as-kamrup-metropolitan",
    "name": "Guwahati",
    "type": "city",
    "districtId": "dist-as-kamrup-metropolitan",
    "districtName": "Kamrup Metropolitan",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.1445,
      91.7362
    ],
    "zoneIds": []
  },
  {
    "id": "city-dispur-as-kamrup-metropolitan",
    "name": "Dispur",
    "type": "city",
    "districtId": "dist-as-kamrup-metropolitan",
    "districtName": "Kamrup Metropolitan",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.15,
      91.79
    ],
    "zoneIds": []
  },
  {
    "id": "city-pan-bazaar-as-kamrup-metropolitan",
    "name": "Pan Bazaar",
    "type": "locality",
    "districtId": "dist-as-kamrup-metropolitan",
    "districtName": "Kamrup Metropolitan",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.185,
      91.748
    ],
    "zoneIds": []
  },
  {
    "id": "city-beltola-as-kamrup-metropolitan",
    "name": "Beltola",
    "type": "locality",
    "districtId": "dist-as-kamrup-metropolitan",
    "districtName": "Kamrup Metropolitan",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.128,
      91.789
    ],
    "zoneIds": []
  },
  {
    "id": "city-chandmari-as-kamrup-metropolitan",
    "name": "Chandmari",
    "type": "locality",
    "districtId": "dist-as-kamrup-metropolitan",
    "districtName": "Kamrup Metropolitan",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.189,
      91.777
    ],
    "zoneIds": []
  },
  {
    "id": "city-maligaon-as-kamrup-metropolitan",
    "name": "Maligaon",
    "type": "locality",
    "districtId": "dist-as-kamrup-metropolitan",
    "districtName": "Kamrup Metropolitan",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.155,
      91.7
    ],
    "zoneIds": []
  },
  {
    "id": "city-jalukbari-as-kamrup-metropolitan",
    "name": "Jalukbari",
    "type": "locality",
    "districtId": "dist-as-kamrup-metropolitan",
    "districtName": "Kamrup Metropolitan",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.152,
      91.666
    ],
    "zoneIds": []
  },
  {
    "id": "city-amingaon-as-kamrup",
    "name": "Amingaon",
    "type": "town",
    "districtId": "dist-as-kamrup",
    "districtName": "Kamrup",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.18,
      91.68
    ],
    "zoneIds": []
  },
  {
    "id": "city-rangia-as-kamrup",
    "name": "Rangia",
    "type": "city",
    "districtId": "dist-as-kamrup",
    "districtName": "Kamrup",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.47,
      91.63
    ],
    "zoneIds": []
  },
  {
    "id": "city-palasbari-as-kamrup",
    "name": "Palasbari",
    "type": "town",
    "districtId": "dist-as-kamrup",
    "districtName": "Kamrup",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.13,
      91.5
    ],
    "zoneIds": []
  },
  {
    "id": "city-hajo-as-kamrup",
    "name": "Hajo",
    "type": "town",
    "districtId": "dist-as-kamrup",
    "districtName": "Kamrup",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.25,
      91.52
    ],
    "zoneIds": []
  },
  {
    "id": "city-mirza-as-kamrup",
    "name": "Mirza",
    "type": "town",
    "districtId": "dist-as-kamrup",
    "districtName": "Kamrup",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.09,
      91.53
    ],
    "zoneIds": []
  },
  {
    "id": "city-chaygaon-as-kamrup",
    "name": "Chaygaon",
    "type": "town",
    "districtId": "dist-as-kamrup",
    "districtName": "Kamrup",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.05,
      91.43
    ],
    "zoneIds": []
  },
  {
    "id": "city-goalpara-as-goalpara",
    "name": "Goalpara",
    "type": "city",
    "districtId": "dist-as-goalpara",
    "districtName": "Goalpara",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.17,
      90.62
    ],
    "zoneIds": []
  },
  {
    "id": "city-dudhnoi-as-goalpara",
    "name": "Dudhnoi",
    "type": "town",
    "districtId": "dist-as-goalpara",
    "districtName": "Goalpara",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.98,
      90.73
    ],
    "zoneIds": []
  },
  {
    "id": "city-lakhipur-as-goalpara",
    "name": "Lakhipur",
    "type": "town",
    "districtId": "dist-as-goalpara",
    "districtName": "Goalpara",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.03,
      90.3
    ],
    "zoneIds": []
  },
  {
    "id": "city-bongaigaon-as-bongaigaon",
    "name": "Bongaigaon",
    "type": "city",
    "districtId": "dist-as-bongaigaon",
    "districtName": "Bongaigaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.5022,
      90.5532
    ],
    "zoneIds": []
  },
  {
    "id": "city-abhayapuri-as-bongaigaon",
    "name": "Abhayapuri",
    "type": "town",
    "districtId": "dist-as-bongaigaon",
    "districtName": "Bongaigaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.33,
      90.67
    ],
    "zoneIds": []
  },
  {
    "id": "city-new-bongaigaon-as-bongaigaon",
    "name": "New Bongaigaon",
    "type": "locality",
    "districtId": "dist-as-bongaigaon",
    "districtName": "Bongaigaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.48,
      90.53
    ],
    "zoneIds": []
  },
  {
    "id": "city-barpeta-as-barpeta",
    "name": "Barpeta",
    "type": "city",
    "districtId": "dist-as-barpeta",
    "districtName": "Barpeta",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.32,
      91.0
    ],
    "zoneIds": []
  },
  {
    "id": "city-barpeta-road-as-barpeta",
    "name": "Barpeta Road",
    "type": "city",
    "districtId": "dist-as-barpeta",
    "districtName": "Barpeta",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.5,
      90.97
    ],
    "zoneIds": []
  },
  {
    "id": "city-sarthebari-as-barpeta",
    "name": "Sarthebari",
    "type": "town",
    "districtId": "dist-as-barpeta",
    "districtName": "Barpeta",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.35,
      91.13
    ],
    "zoneIds": []
  },
  {
    "id": "city-howly-as-barpeta",
    "name": "Howly",
    "type": "town",
    "districtId": "dist-as-barpeta",
    "districtName": "Barpeta",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.43,
      90.97
    ],
    "zoneIds": []
  },
  {
    "id": "city-pathsala-as-bajali",
    "name": "Pathsala",
    "type": "city",
    "districtId": "dist-as-bajali",
    "districtName": "Bajali",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.5,
      91.18
    ],
    "zoneIds": []
  },
  {
    "id": "city-bhowanipur-as-bajali",
    "name": "Bhowanipur",
    "type": "town",
    "districtId": "dist-as-bajali",
    "districtName": "Bajali",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.45,
      91.1
    ],
    "zoneIds": []
  },
  {
    "id": "city-nalbari-as-nalbari",
    "name": "Nalbari",
    "type": "city",
    "districtId": "dist-as-nalbari",
    "districtName": "Nalbari",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.44,
      91.44
    ],
    "zoneIds": []
  },
  {
    "id": "city-tihu-as-nalbari",
    "name": "Tihu",
    "type": "town",
    "districtId": "dist-as-nalbari",
    "districtName": "Nalbari",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.47,
      91.2
    ],
    "zoneIds": []
  },
  {
    "id": "city-mukalmua-as-nalbari",
    "name": "Mukalmua",
    "type": "town",
    "districtId": "dist-as-nalbari",
    "districtName": "Nalbari",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.27,
      91.38
    ],
    "zoneIds": []
  },
  {
    "id": "city-belsor-as-nalbari",
    "name": "Belsor",
    "type": "town",
    "districtId": "dist-as-nalbari",
    "districtName": "Nalbari",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.35,
      91.38
    ],
    "zoneIds": []
  },
  {
    "id": "city-musalpur-as-baksa",
    "name": "Musalpur",
    "type": "town",
    "districtId": "dist-as-baksa",
    "districtName": "Baksa",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.58,
      91.4
    ],
    "zoneIds": []
  },
  {
    "id": "city-tamulpur-as-baksa",
    "name": "Tamulpur",
    "type": "town",
    "districtId": "dist-as-baksa",
    "districtName": "Baksa",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.63,
      91.57
    ],
    "zoneIds": []
  },
  {
    "id": "city-barama-as-baksa",
    "name": "Barama",
    "type": "town",
    "districtId": "dist-as-baksa",
    "districtName": "Baksa",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.52,
      91.35
    ],
    "zoneIds": []
  },
  {
    "id": "city-tamulpur-as-tamulpur",
    "name": "Tamulpur",
    "type": "city",
    "districtId": "dist-as-tamulpur",
    "districtName": "Tamulpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.63,
      91.57
    ],
    "zoneIds": []
  },
  {
    "id": "city-nagrijuli-as-tamulpur",
    "name": "Nagrijuli",
    "type": "town",
    "districtId": "dist-as-tamulpur",
    "districtName": "Tamulpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.75,
      91.6
    ],
    "zoneIds": []
  },
  {
    "id": "city-kumarikata-as-tamulpur",
    "name": "Kumarikata",
    "type": "town",
    "districtId": "dist-as-tamulpur",
    "districtName": "Tamulpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.7,
      91.53
    ],
    "zoneIds": []
  },
  {
    "id": "city-kajalgon-as-chirang",
    "name": "Kajalgon",
    "type": "town",
    "districtId": "dist-as-chirang",
    "districtName": "Chirang",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.53,
      90.5
    ],
    "zoneIds": []
  },
  {
    "id": "city-bijni-as-chirang",
    "name": "Bijni",
    "type": "town",
    "districtId": "dist-as-chirang",
    "districtName": "Chirang",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.52,
      90.7
    ],
    "zoneIds": []
  },
  {
    "id": "city-basugaon-as-chirang",
    "name": "Basugaon",
    "type": "town",
    "districtId": "dist-as-chirang",
    "districtName": "Chirang",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.47,
      90.4
    ],
    "zoneIds": []
  },
  {
    "id": "city-kokrajhar-as-kokrajhar",
    "name": "Kokrajhar",
    "type": "city",
    "districtId": "dist-as-kokrajhar",
    "districtName": "Kokrajhar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.4014,
      90.2719
    ],
    "zoneIds": []
  },
  {
    "id": "city-gossaigaon-as-kokrajhar",
    "name": "Gossaigaon",
    "type": "town",
    "districtId": "dist-as-kokrajhar",
    "districtName": "Kokrajhar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.45,
      89.97
    ],
    "zoneIds": []
  },
  {
    "id": "city-fakiragram-as-kokrajhar",
    "name": "Fakiragram",
    "type": "town",
    "districtId": "dist-as-kokrajhar",
    "districtName": "Kokrajhar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.28,
      90.2
    ],
    "zoneIds": []
  },
  {
    "id": "city-salakati-as-kokrajhar",
    "name": "Salakati",
    "type": "town",
    "districtId": "dist-as-kokrajhar",
    "districtName": "Kokrajhar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.48,
      90.35
    ],
    "zoneIds": []
  },
  {
    "id": "city-mangaldai-as-darrang",
    "name": "Mangaldai",
    "type": "city",
    "districtId": "dist-as-darrang",
    "districtName": "Darrang",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.43,
      92.03
    ],
    "zoneIds": []
  },
  {
    "id": "city-kharupetia-as-darrang",
    "name": "Kharupetia",
    "type": "town",
    "districtId": "dist-as-darrang",
    "districtName": "Darrang",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.52,
      92.13
    ],
    "zoneIds": []
  },
  {
    "id": "city-sipajhar-as-darrang",
    "name": "Sipajhar",
    "type": "town",
    "districtId": "dist-as-darrang",
    "districtName": "Darrang",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.37,
      91.88
    ],
    "zoneIds": []
  },
  {
    "id": "city-udalguri-as-udalguri",
    "name": "Udalguri",
    "type": "city",
    "districtId": "dist-as-udalguri",
    "districtName": "Udalguri",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.74,
      92.1
    ],
    "zoneIds": []
  },
  {
    "id": "city-tangla-as-udalguri",
    "name": "Tangla",
    "type": "town",
    "districtId": "dist-as-udalguri",
    "districtName": "Udalguri",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.65,
      91.9
    ],
    "zoneIds": []
  },
  {
    "id": "city-rowta-as-udalguri",
    "name": "Rowta",
    "type": "town",
    "districtId": "dist-as-udalguri",
    "districtName": "Udalguri",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.7,
      92.23
    ],
    "zoneIds": []
  },
  {
    "id": "city-bhairabkunda-as-udalguri",
    "name": "Bhairabkunda",
    "type": "locality",
    "districtId": "dist-as-udalguri",
    "districtName": "Udalguri",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.9,
      92.12
    ],
    "zoneIds": []
  },
  {
    "id": "city-tezpur-as-sonitpur",
    "name": "Tezpur",
    "type": "city",
    "districtId": "dist-as-sonitpur",
    "districtName": "Sonitpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.6338,
      92.8006
    ],
    "zoneIds": []
  },
  {
    "id": "city-dhekiajuli-as-sonitpur",
    "name": "Dhekiajuli",
    "type": "town",
    "districtId": "dist-as-sonitpur",
    "districtName": "Sonitpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.7,
      92.5
    ],
    "zoneIds": []
  },
  {
    "id": "city-rangapara-as-sonitpur",
    "name": "Rangapara",
    "type": "town",
    "districtId": "dist-as-sonitpur",
    "districtName": "Sonitpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.82,
      92.65
    ],
    "zoneIds": []
  },
  {
    "id": "city-jamugurihat-as-sonitpur",
    "name": "Jamugurihat",
    "type": "town",
    "districtId": "dist-as-sonitpur",
    "districtName": "Sonitpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.73,
      92.97
    ],
    "zoneIds": []
  },
  {
    "id": "city-biswanath-chariali-as-biswanath",
    "name": "Biswanath Chariali",
    "type": "city",
    "districtId": "dist-as-biswanath",
    "districtName": "Biswanath",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.73,
      93.15
    ],
    "zoneIds": []
  },
  {
    "id": "city-gohpur-as-biswanath",
    "name": "Gohpur",
    "type": "town",
    "districtId": "dist-as-biswanath",
    "districtName": "Biswanath",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.88,
      93.63
    ],
    "zoneIds": []
  },
  {
    "id": "city-helem-as-biswanath",
    "name": "Helem",
    "type": "town",
    "districtId": "dist-as-biswanath",
    "districtName": "Biswanath",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.83,
      93.52
    ],
    "zoneIds": []
  },
  {
    "id": "city-north-lakhimpur-as-lakhimpur",
    "name": "North Lakhimpur",
    "type": "city",
    "districtId": "dist-as-lakhimpur",
    "districtName": "Lakhimpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.23,
      94.1
    ],
    "zoneIds": []
  },
  {
    "id": "city-bihpuria-as-lakhimpur",
    "name": "Bihpuria",
    "type": "town",
    "districtId": "dist-as-lakhimpur",
    "districtName": "Lakhimpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.02,
      93.9
    ],
    "zoneIds": []
  },
  {
    "id": "city-narayanpur-as-lakhimpur",
    "name": "Narayanpur",
    "type": "town",
    "districtId": "dist-as-lakhimpur",
    "districtName": "Lakhimpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.98,
      93.85
    ],
    "zoneIds": []
  },
  {
    "id": "city-dhakuakhana-as-lakhimpur",
    "name": "Dhakuakhana",
    "type": "town",
    "districtId": "dist-as-lakhimpur",
    "districtName": "Lakhimpur",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.25,
      94.45
    ],
    "zoneIds": []
  },
  {
    "id": "city-dhemaji-as-dhemaji",
    "name": "Dhemaji",
    "type": "city",
    "districtId": "dist-as-dhemaji",
    "districtName": "Dhemaji",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.48,
      94.58
    ],
    "zoneIds": []
  },
  {
    "id": "city-silapathar-as-dhemaji",
    "name": "Silapathar",
    "type": "city",
    "districtId": "dist-as-dhemaji",
    "districtName": "Dhemaji",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.6,
      94.73
    ],
    "zoneIds": []
  },
  {
    "id": "city-jonai-as-dhemaji",
    "name": "Jonai",
    "type": "town",
    "districtId": "dist-as-dhemaji",
    "districtName": "Dhemaji",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.83,
      95.22
    ],
    "zoneIds": []
  },
  {
    "id": "city-gogamukh-as-dhemaji",
    "name": "Gogamukh",
    "type": "town",
    "districtId": "dist-as-dhemaji",
    "districtName": "Dhemaji",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.42,
      94.4
    ],
    "zoneIds": []
  },
  {
    "id": "city-morigaon-as-morigaon",
    "name": "Morigaon",
    "type": "city",
    "districtId": "dist-as-morigaon",
    "districtName": "Morigaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.25,
      92.34
    ],
    "zoneIds": []
  },
  {
    "id": "city-jagiroad-as-morigaon",
    "name": "Jagiroad",
    "type": "town",
    "districtId": "dist-as-morigaon",
    "districtName": "Morigaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.12,
      92.22
    ],
    "zoneIds": []
  },
  {
    "id": "city-mayong-as-morigaon",
    "name": "Mayong",
    "type": "locality",
    "districtId": "dist-as-morigaon",
    "districtName": "Morigaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.25,
      92.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-bhuragaon-as-morigaon",
    "name": "Bhuragaon",
    "type": "town",
    "districtId": "dist-as-morigaon",
    "districtName": "Morigaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.43,
      92.35
    ],
    "zoneIds": []
  },
  {
    "id": "city-nagaon-as-nagaon",
    "name": "Nagaon",
    "type": "city",
    "districtId": "dist-as-nagaon",
    "districtName": "Nagaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.3468,
      92.684
    ],
    "zoneIds": []
  },
  {
    "id": "city-kaliabor-as-nagaon",
    "name": "Kaliabor",
    "type": "town",
    "districtId": "dist-as-nagaon",
    "districtName": "Nagaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.55,
      92.98
    ],
    "zoneIds": []
  },
  {
    "id": "city-raha-as-nagaon",
    "name": "Raha",
    "type": "town",
    "districtId": "dist-as-nagaon",
    "districtName": "Nagaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.23,
      92.52
    ],
    "zoneIds": []
  },
  {
    "id": "city-dhing-as-nagaon",
    "name": "Dhing",
    "type": "town",
    "districtId": "dist-as-nagaon",
    "districtName": "Nagaon",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.47,
      92.47
    ],
    "zoneIds": []
  },
  {
    "id": "city-hojai-as-hojai",
    "name": "Hojai",
    "type": "city",
    "districtId": "dist-as-hojai",
    "districtName": "Hojai",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.0,
      92.86
    ],
    "zoneIds": []
  },
  {
    "id": "city-lanka-as-hojai",
    "name": "Lanka",
    "type": "town",
    "districtId": "dist-as-hojai",
    "districtName": "Hojai",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.92,
      92.95
    ],
    "zoneIds": []
  },
  {
    "id": "city-lumding-as-hojai",
    "name": "Lumding",
    "type": "city",
    "districtId": "dist-as-hojai",
    "districtName": "Hojai",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.75,
      93.17
    ],
    "zoneIds": []
  },
  {
    "id": "city-doboka-as-hojai",
    "name": "Doboka",
    "type": "town",
    "districtId": "dist-as-hojai",
    "districtName": "Hojai",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.13,
      92.87
    ],
    "zoneIds": []
  },
  {
    "id": "city-golaghat-as-golaghat",
    "name": "Golaghat",
    "type": "city",
    "districtId": "dist-as-golaghat",
    "districtName": "Golaghat",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.52,
      93.97
    ],
    "zoneIds": []
  },
  {
    "id": "city-bokakhat-as-golaghat",
    "name": "Bokakhat",
    "type": "town",
    "districtId": "dist-as-golaghat",
    "districtName": "Golaghat",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.63,
      93.6
    ],
    "zoneIds": []
  },
  {
    "id": "city-sarupathar-as-golaghat",
    "name": "Sarupathar",
    "type": "town",
    "districtId": "dist-as-golaghat",
    "districtName": "Golaghat",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.18,
      93.83
    ],
    "zoneIds": []
  },
  {
    "id": "city-dergaon-as-golaghat",
    "name": "Dergaon",
    "type": "town",
    "districtId": "dist-as-golaghat",
    "districtName": "Golaghat",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.7,
      94.03
    ],
    "zoneIds": []
  },
  {
    "id": "city-numaligarh-as-golaghat",
    "name": "Numaligarh",
    "type": "town",
    "districtId": "dist-as-golaghat",
    "districtName": "Golaghat",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.62,
      93.75
    ],
    "zoneIds": []
  },
  {
    "id": "city-jorhat-as-jorhat",
    "name": "Jorhat",
    "type": "city",
    "districtId": "dist-as-jorhat",
    "districtName": "Jorhat",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.7509,
      94.2037
    ],
    "zoneIds": []
  },
  {
    "id": "city-mariani-as-jorhat",
    "name": "Mariani",
    "type": "town",
    "districtId": "dist-as-jorhat",
    "districtName": "Jorhat",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.66,
      94.33
    ],
    "zoneIds": []
  },
  {
    "id": "city-titabar-as-jorhat",
    "name": "Titabar",
    "type": "town",
    "districtId": "dist-as-jorhat",
    "districtName": "Jorhat",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.58,
      94.2
    ],
    "zoneIds": []
  },
  {
    "id": "city-teok-as-jorhat",
    "name": "Teok",
    "type": "town",
    "districtId": "dist-as-jorhat",
    "districtName": "Jorhat",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.83,
      94.42
    ],
    "zoneIds": []
  },
  {
    "id": "city-garamur-as-majuli",
    "name": "Garamur",
    "type": "town",
    "districtId": "dist-as-majuli",
    "districtName": "Majuli",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.96,
      94.22
    ],
    "zoneIds": []
  },
  {
    "id": "city-kamalabari-as-majuli",
    "name": "Kamalabari",
    "type": "town",
    "districtId": "dist-as-majuli",
    "districtName": "Majuli",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.93,
      94.17
    ],
    "zoneIds": []
  },
  {
    "id": "city-jengraimukh-as-majuli",
    "name": "Jengraimukh",
    "type": "town",
    "districtId": "dist-as-majuli",
    "districtName": "Majuli",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.05,
      94.4
    ],
    "zoneIds": []
  },
  {
    "id": "city-sivasagar-as-sivasagar",
    "name": "Sivasagar",
    "type": "city",
    "districtId": "dist-as-sivasagar",
    "districtName": "Sivasagar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.9826,
      94.6425
    ],
    "zoneIds": []
  },
  {
    "id": "city-nazira-as-sivasagar",
    "name": "Nazira",
    "type": "town",
    "districtId": "dist-as-sivasagar",
    "districtName": "Sivasagar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.92,
      94.73
    ],
    "zoneIds": []
  },
  {
    "id": "city-amguri-as-sivasagar",
    "name": "Amguri",
    "type": "town",
    "districtId": "dist-as-sivasagar",
    "districtName": "Sivasagar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.81,
      94.57
    ],
    "zoneIds": []
  },
  {
    "id": "city-demow-as-sivasagar",
    "name": "Demow",
    "type": "town",
    "districtId": "dist-as-sivasagar",
    "districtName": "Sivasagar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.14,
      94.74
    ],
    "zoneIds": []
  },
  {
    "id": "city-sonari-as-charaideo",
    "name": "Sonari",
    "type": "city",
    "districtId": "dist-as-charaideo",
    "districtName": "Charaideo",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.02,
      95.03
    ],
    "zoneIds": []
  },
  {
    "id": "city-moran-as-charaideo",
    "name": "Moran",
    "type": "town",
    "districtId": "dist-as-charaideo",
    "districtName": "Charaideo",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.18,
      94.92
    ],
    "zoneIds": []
  },
  {
    "id": "city-charaideo-maidam-as-charaideo",
    "name": "Charaideo Maidam",
    "type": "locality",
    "districtId": "dist-as-charaideo",
    "districtName": "Charaideo",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.95,
      94.87
    ],
    "zoneIds": []
  },
  {
    "id": "city-dibrugarh-as-dibrugarh",
    "name": "Dibrugarh",
    "type": "city",
    "districtId": "dist-as-dibrugarh",
    "districtName": "Dibrugarh",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.4728,
      94.912
    ],
    "zoneIds": []
  },
  {
    "id": "city-chabua-as-dibrugarh",
    "name": "Chabua",
    "type": "town",
    "districtId": "dist-as-dibrugarh",
    "districtName": "Dibrugarh",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.48,
      95.17
    ],
    "zoneIds": []
  },
  {
    "id": "city-naharkatia-as-dibrugarh",
    "name": "Naharkatia",
    "type": "town",
    "districtId": "dist-as-dibrugarh",
    "districtName": "Dibrugarh",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.28,
      95.26
    ],
    "zoneIds": []
  },
  {
    "id": "city-namrup-as-dibrugarh",
    "name": "Namrup",
    "type": "town",
    "districtId": "dist-as-dibrugarh",
    "districtName": "Dibrugarh",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.18,
      95.34
    ],
    "zoneIds": []
  },
  {
    "id": "city-moranhat-as-dibrugarh",
    "name": "Moranhat",
    "type": "town",
    "districtId": "dist-as-dibrugarh",
    "districtName": "Dibrugarh",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.19,
      94.93
    ],
    "zoneIds": []
  },
  {
    "id": "city-tinsukia-as-tinsukia",
    "name": "Tinsukia",
    "type": "city",
    "districtId": "dist-as-tinsukia",
    "districtName": "Tinsukia",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.4922,
      95.3468
    ],
    "zoneIds": []
  },
  {
    "id": "city-digboi-as-tinsukia",
    "name": "Digboi",
    "type": "town",
    "districtId": "dist-as-tinsukia",
    "districtName": "Tinsukia",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.38,
      95.63
    ],
    "zoneIds": []
  },
  {
    "id": "city-margherita-as-tinsukia",
    "name": "Margherita",
    "type": "town",
    "districtId": "dist-as-tinsukia",
    "districtName": "Tinsukia",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.28,
      95.68
    ],
    "zoneIds": []
  },
  {
    "id": "city-doomdooma-as-tinsukia",
    "name": "Doomdooma",
    "type": "town",
    "districtId": "dist-as-tinsukia",
    "districtName": "Tinsukia",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.57,
      95.57
    ],
    "zoneIds": []
  },
  {
    "id": "city-ledo-as-tinsukia",
    "name": "Ledo",
    "type": "locality",
    "districtId": "dist-as-tinsukia",
    "districtName": "Tinsukia",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      27.3,
      95.74
    ],
    "zoneIds": []
  },
  {
    "id": "city-hatsingimari-as-south-salmara",
    "name": "Hatsingimari",
    "type": "city",
    "districtId": "dist-as-south-salmara",
    "districtName": "South Salmara-Mankachar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.68,
      89.88
    ],
    "zoneIds": []
  },
  {
    "id": "city-mankachar-as-south-salmara",
    "name": "Mankachar",
    "type": "town",
    "districtId": "dist-as-south-salmara",
    "districtName": "South Salmara-Mankachar",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      25.53,
      89.87
    ],
    "zoneIds": []
  },
  {
    "id": "city-dhubri-as-dhubri",
    "name": "Dhubri",
    "type": "city",
    "districtId": "dist-as-dhubri",
    "districtName": "Dhubri",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.02,
      89.97
    ],
    "zoneIds": []
  },
  {
    "id": "city-gauripur-as-dhubri",
    "name": "Gauripur",
    "type": "town",
    "districtId": "dist-as-dhubri",
    "districtName": "Dhubri",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.08,
      89.97
    ],
    "zoneIds": []
  },
  {
    "id": "city-bilasipara-as-dhubri",
    "name": "Bilasipara",
    "type": "town",
    "districtId": "dist-as-dhubri",
    "districtName": "Dhubri",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.23,
      90.23
    ],
    "zoneIds": []
  },
  {
    "id": "city-chapar-as-dhubri",
    "name": "Chapar",
    "type": "town",
    "districtId": "dist-as-dhubri",
    "districtName": "Dhubri",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.27,
      90.47
    ],
    "zoneIds": []
  },
  {
    "id": "city-golakganj-as-dhubri",
    "name": "Golakganj",
    "type": "town",
    "districtId": "dist-as-dhubri",
    "districtName": "Dhubri",
    "stateId": "state-as",
    "stateName": "Assam",
    "centroid": [
      26.1,
      89.83
    ],
    "zoneIds": []
  },
  {
    "id": "city-tamenglong-mn-tamenglong",
    "name": "Tamenglong",
    "type": "city",
    "districtId": "dist-mn-tamenglong",
    "districtName": "Tamenglong",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.9833,
      93.4833
    ],
    "zoneIds": [
      1
    ]
  },
  {
    "id": "city-khongsang-mn-tamenglong",
    "name": "Khongsang",
    "type": "town",
    "districtId": "dist-mn-tamenglong",
    "districtName": "Tamenglong",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.85,
      93.52
    ],
    "zoneIds": [
      1
    ]
  },
  {
    "id": "city-tamei-mn-tamenglong",
    "name": "Tamei",
    "type": "town",
    "districtId": "dist-mn-tamenglong",
    "districtName": "Tamenglong",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.18,
      93.65
    ],
    "zoneIds": [
      1
    ]
  },
  {
    "id": "city-nungba-mn-tamenglong",
    "name": "Nungba",
    "type": "town",
    "districtId": "dist-mn-tamenglong",
    "districtName": "Tamenglong",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.78,
      93.45
    ],
    "zoneIds": [
      1
    ]
  },
  {
    "id": "city-noney-mn-noney",
    "name": "Noney",
    "type": "city",
    "districtId": "dist-mn-noney",
    "districtName": "Noney",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.8,
      93.65
    ],
    "zoneIds": [
      2
    ]
  },
  {
    "id": "city-longmai-mn-noney",
    "name": "Longmai",
    "type": "town",
    "districtId": "dist-mn-noney",
    "districtName": "Noney",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.81,
      93.64
    ],
    "zoneIds": [
      2
    ]
  },
  {
    "id": "city-tupul-mn-noney",
    "name": "Tupul",
    "type": "locality",
    "districtId": "dist-mn-noney",
    "districtName": "Noney",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.83,
      93.7
    ],
    "zoneIds": [
      2
    ]
  },
  {
    "id": "city-haochong-mn-noney",
    "name": "Haochong",
    "type": "town",
    "districtId": "dist-mn-noney",
    "districtName": "Noney",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.95,
      93.6
    ],
    "zoneIds": [
      2
    ]
  },
  {
    "id": "city-imphal-mn-imphal-west",
    "name": "Imphal",
    "type": "city",
    "districtId": "dist-mn-imphal-west",
    "districtName": "Imphal West",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.817,
      93.9368
    ],
    "zoneIds": []
  },
  {
    "id": "city-lamphelpat-mn-imphal-west",
    "name": "Lamphelpat",
    "type": "locality",
    "districtId": "dist-mn-imphal-west",
    "districtName": "Imphal West",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.82,
      93.91
    ],
    "zoneIds": []
  },
  {
    "id": "city-uripok-mn-imphal-west",
    "name": "Uripok",
    "type": "locality",
    "districtId": "dist-mn-imphal-west",
    "districtName": "Imphal West",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.81,
      93.92
    ],
    "zoneIds": []
  },
  {
    "id": "city-singjamei-mn-imphal-west",
    "name": "Singjamei",
    "type": "locality",
    "districtId": "dist-mn-imphal-west",
    "districtName": "Imphal West",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.78,
      93.94
    ],
    "zoneIds": []
  },
  {
    "id": "city-lamsang-mn-imphal-west",
    "name": "Lamsang",
    "type": "town",
    "districtId": "dist-mn-imphal-west",
    "districtName": "Imphal West",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.87,
      93.87
    ],
    "zoneIds": []
  },
  {
    "id": "city-wangoi-mn-imphal-west",
    "name": "Wangoi",
    "type": "town",
    "districtId": "dist-mn-imphal-west",
    "districtName": "Imphal West",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.7,
      93.9
    ],
    "zoneIds": []
  },
  {
    "id": "city-mayang-imphal-mn-imphal-west",
    "name": "Mayang Imphal",
    "type": "town",
    "districtId": "dist-mn-imphal-west",
    "districtName": "Imphal West",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.62,
      93.88
    ],
    "zoneIds": []
  },
  {
    "id": "city-porompat-mn-imphal-east",
    "name": "Porompat",
    "type": "city",
    "districtId": "dist-mn-imphal-east",
    "districtName": "Imphal East",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.81,
      93.96
    ],
    "zoneIds": []
  },
  {
    "id": "city-sawombung-mn-imphal-east",
    "name": "Sawombung",
    "type": "town",
    "districtId": "dist-mn-imphal-east",
    "districtName": "Imphal East",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.88,
      94.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-lamlai-mn-imphal-east",
    "name": "Lamlai",
    "type": "town",
    "districtId": "dist-mn-imphal-east",
    "districtName": "Imphal East",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.85,
      94.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-andro-mn-imphal-east",
    "name": "Andro",
    "type": "town",
    "districtId": "dist-mn-imphal-east",
    "districtName": "Imphal East",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.77,
      94.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-bishnupur-mn-bishnupur",
    "name": "Bishnupur",
    "type": "city",
    "districtId": "dist-mn-bishnupur",
    "districtName": "Bishnupur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.63,
      93.77
    ],
    "zoneIds": []
  },
  {
    "id": "city-moirang-mn-bishnupur",
    "name": "Moirang",
    "type": "city",
    "districtId": "dist-mn-bishnupur",
    "districtName": "Bishnupur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.5,
      93.77
    ],
    "zoneIds": []
  },
  {
    "id": "city-nambol-mn-bishnupur",
    "name": "Nambol",
    "type": "town",
    "districtId": "dist-mn-bishnupur",
    "districtName": "Bishnupur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.72,
      93.83
    ],
    "zoneIds": []
  },
  {
    "id": "city-ningthoukhong-mn-bishnupur",
    "name": "Ningthoukhong",
    "type": "town",
    "districtId": "dist-mn-bishnupur",
    "districtName": "Bishnupur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.57,
      93.78
    ],
    "zoneIds": []
  },
  {
    "id": "city-loktak-mn-bishnupur",
    "name": "Loktak",
    "type": "locality",
    "districtId": "dist-mn-bishnupur",
    "districtName": "Bishnupur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.55,
      93.8
    ],
    "zoneIds": []
  },
  {
    "id": "city-thoubal-mn-thoubal",
    "name": "Thoubal",
    "type": "city",
    "districtId": "dist-mn-thoubal",
    "districtName": "Thoubal",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.63,
      94.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-yairipok-mn-thoubal",
    "name": "Yairipok",
    "type": "town",
    "districtId": "dist-mn-thoubal",
    "districtName": "Thoubal",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.68,
      94.07
    ],
    "zoneIds": []
  },
  {
    "id": "city-lilong-mn-thoubal",
    "name": "Lilong",
    "type": "town",
    "districtId": "dist-mn-thoubal",
    "districtName": "Thoubal",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.73,
      93.95
    ],
    "zoneIds": []
  },
  {
    "id": "city-wangjing-mn-thoubal",
    "name": "Wangjing",
    "type": "town",
    "districtId": "dist-mn-thoubal",
    "districtName": "Thoubal",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.6,
      94.03
    ],
    "zoneIds": []
  },
  {
    "id": "city-kakching-mn-kakching",
    "name": "Kakching",
    "type": "city",
    "districtId": "dist-mn-kakching",
    "districtName": "Kakching",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.48,
      93.98
    ],
    "zoneIds": []
  },
  {
    "id": "city-sugnoo-mn-kakching",
    "name": "Sugnoo",
    "type": "town",
    "districtId": "dist-mn-kakching",
    "districtName": "Kakching",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.32,
      93.87
    ],
    "zoneIds": []
  },
  {
    "id": "city-kakching-khunou-mn-kakching",
    "name": "Kakching Khunou",
    "type": "town",
    "districtId": "dist-mn-kakching",
    "districtName": "Kakching",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.43,
      93.9
    ],
    "zoneIds": []
  },
  {
    "id": "city-ukhrul-mn-ukhrul",
    "name": "Ukhrul",
    "type": "city",
    "districtId": "dist-mn-ukhrul",
    "districtName": "Ukhrul",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.11,
      94.36
    ],
    "zoneIds": []
  },
  {
    "id": "city-shirui-mn-ukhrul",
    "name": "Shirui",
    "type": "locality",
    "districtId": "dist-mn-ukhrul",
    "districtName": "Ukhrul",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.12,
      94.43
    ],
    "zoneIds": []
  },
  {
    "id": "city-jessami-mn-ukhrul",
    "name": "Jessami",
    "type": "town",
    "districtId": "dist-mn-ukhrul",
    "districtName": "Ukhrul",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.62,
      94.52
    ],
    "zoneIds": []
  },
  {
    "id": "city-chingai-mn-ukhrul",
    "name": "Chingai",
    "type": "town",
    "districtId": "dist-mn-ukhrul",
    "districtName": "Ukhrul",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.38,
      94.5
    ],
    "zoneIds": []
  },
  {
    "id": "city-kamjong-mn-kamjong",
    "name": "Kamjong",
    "type": "city",
    "districtId": "dist-mn-kamjong",
    "districtName": "Kamjong",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.85,
      94.52
    ],
    "zoneIds": []
  },
  {
    "id": "city-phungyar-mn-kamjong",
    "name": "Phungyar",
    "type": "town",
    "districtId": "dist-mn-kamjong",
    "districtName": "Kamjong",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.9,
      94.32
    ],
    "zoneIds": []
  },
  {
    "id": "city-kasom-khullen-mn-kamjong",
    "name": "Kasom Khullen",
    "type": "town",
    "districtId": "dist-mn-kamjong",
    "districtName": "Kamjong",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.68,
      94.25
    ],
    "zoneIds": []
  },
  {
    "id": "city-churachandpur-mn-churachandpur",
    "name": "Churachandpur",
    "type": "city",
    "districtId": "dist-mn-churachandpur",
    "districtName": "Churachandpur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.3333,
      93.6833
    ],
    "zoneIds": []
  },
  {
    "id": "city-lamka-mn-churachandpur",
    "name": "Lamka",
    "type": "city",
    "districtId": "dist-mn-churachandpur",
    "districtName": "Churachandpur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.34,
      93.68
    ],
    "zoneIds": []
  },
  {
    "id": "city-tuibong-mn-churachandpur",
    "name": "Tuibong",
    "type": "town",
    "districtId": "dist-mn-churachandpur",
    "districtName": "Churachandpur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.36,
      93.69
    ],
    "zoneIds": []
  },
  {
    "id": "city-singngat-mn-churachandpur",
    "name": "Singngat",
    "type": "town",
    "districtId": "dist-mn-churachandpur",
    "districtName": "Churachandpur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.15,
      93.58
    ],
    "zoneIds": []
  },
  {
    "id": "city-henglep-mn-churachandpur",
    "name": "Henglep",
    "type": "town",
    "districtId": "dist-mn-churachandpur",
    "districtName": "Churachandpur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.5,
      93.55
    ],
    "zoneIds": []
  },
  {
    "id": "city-behiang-mn-churachandpur",
    "name": "Behiang",
    "type": "town",
    "districtId": "dist-mn-churachandpur",
    "districtName": "Churachandpur",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.02,
      93.42
    ],
    "zoneIds": []
  },
  {
    "id": "city-pherzawl-mn-pherzawl",
    "name": "Pherzawl",
    "type": "city",
    "districtId": "dist-mn-pherzawl",
    "districtName": "Pherzawl",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.25,
      93.2
    ],
    "zoneIds": []
  },
  {
    "id": "city-parbung-mn-pherzawl",
    "name": "Parbung",
    "type": "town",
    "districtId": "dist-mn-pherzawl",
    "districtName": "Pherzawl",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.15,
      93.15
    ],
    "zoneIds": []
  },
  {
    "id": "city-thanlon-mn-pherzawl",
    "name": "Thanlon",
    "type": "town",
    "districtId": "dist-mn-pherzawl",
    "districtName": "Pherzawl",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.35,
      93.3
    ],
    "zoneIds": []
  },
  {
    "id": "city-tipaimukh-mn-pherzawl",
    "name": "Tipaimukh",
    "type": "town",
    "districtId": "dist-mn-pherzawl",
    "districtName": "Pherzawl",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.23,
      93.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-senapati-mn-senapati",
    "name": "Senapati",
    "type": "city",
    "districtId": "dist-mn-senapati",
    "districtName": "Senapati",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.27,
      94.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-mao-mn-senapati",
    "name": "Mao",
    "type": "town",
    "districtId": "dist-mn-senapati",
    "districtName": "Senapati",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.5,
      94.13
    ],
    "zoneIds": []
  },
  {
    "id": "city-maram-mn-senapati",
    "name": "Maram",
    "type": "town",
    "districtId": "dist-mn-senapati",
    "districtName": "Senapati",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.4,
      94.08
    ],
    "zoneIds": []
  },
  {
    "id": "city-tadubi-mn-senapati",
    "name": "Tadubi",
    "type": "town",
    "districtId": "dist-mn-senapati",
    "districtName": "Senapati",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.48,
      94.12
    ],
    "zoneIds": []
  },
  {
    "id": "city-purul-mn-senapati",
    "name": "Purul",
    "type": "town",
    "districtId": "dist-mn-senapati",
    "districtName": "Senapati",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.32,
      94.2
    ],
    "zoneIds": []
  },
  {
    "id": "city-kangpokpi-mn-kangpokpi",
    "name": "Kangpokpi",
    "type": "city",
    "districtId": "dist-mn-kangpokpi",
    "districtName": "Kangpokpi",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.15,
      93.97
    ],
    "zoneIds": []
  },
  {
    "id": "city-motbung-mn-kangpokpi",
    "name": "Motbung",
    "type": "town",
    "districtId": "dist-mn-kangpokpi",
    "districtName": "Kangpokpi",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.02,
      93.92
    ],
    "zoneIds": []
  },
  {
    "id": "city-saikul-mn-kangpokpi",
    "name": "Saikul",
    "type": "town",
    "districtId": "dist-mn-kangpokpi",
    "districtName": "Kangpokpi",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.08,
      94.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-keithelmanbi-mn-kangpokpi",
    "name": "Keithelmanbi",
    "type": "town",
    "districtId": "dist-mn-kangpokpi",
    "districtName": "Kangpokpi",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      25.12,
      93.95
    ],
    "zoneIds": []
  },
  {
    "id": "city-chandel-mn-chandel",
    "name": "Chandel",
    "type": "city",
    "districtId": "dist-mn-chandel",
    "districtName": "Chandel",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.32,
      94.0
    ],
    "zoneIds": []
  },
  {
    "id": "city-moreh-mn-chandel",
    "name": "Moreh",
    "type": "city",
    "districtId": "dist-mn-chandel",
    "districtName": "Chandel",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.25,
      94.3
    ],
    "zoneIds": []
  },
  {
    "id": "city-machi-mn-chandel",
    "name": "Machi",
    "type": "town",
    "districtId": "dist-mn-chandel",
    "districtName": "Chandel",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.47,
      94.08
    ],
    "zoneIds": []
  },
  {
    "id": "city-chakpikarong-mn-chandel",
    "name": "Chakpikarong",
    "type": "town",
    "districtId": "dist-mn-chandel",
    "districtName": "Chandel",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.2,
      93.93
    ],
    "zoneIds": []
  },
  {
    "id": "city-tengnoupal-mn-tengnoupal",
    "name": "Tengnoupal",
    "type": "city",
    "districtId": "dist-mn-tengnoupal",
    "districtName": "Tengnoupal",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.4,
      94.15
    ],
    "zoneIds": []
  },
  {
    "id": "city-moreh-border-mn-tengnoupal",
    "name": "Moreh Border",
    "type": "town",
    "districtId": "dist-mn-tengnoupal",
    "districtName": "Tengnoupal",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.25,
      94.3
    ],
    "zoneIds": []
  },
  {
    "id": "city-pallel-mn-tengnoupal",
    "name": "Pallel",
    "type": "town",
    "districtId": "dist-mn-tengnoupal",
    "districtName": "Tengnoupal",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.52,
      94.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-jiribam-mn-jiribam",
    "name": "Jiribam",
    "type": "city",
    "districtId": "dist-mn-jiribam",
    "districtName": "Jiribam",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.8,
      93.12
    ],
    "zoneIds": []
  },
  {
    "id": "city-babupara-mn-jiribam",
    "name": "Babupara",
    "type": "locality",
    "districtId": "dist-mn-jiribam",
    "districtName": "Jiribam",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.81,
      93.13
    ],
    "zoneIds": []
  },
  {
    "id": "city-gularthol-mn-jiribam",
    "name": "Gularthol",
    "type": "town",
    "districtId": "dist-mn-jiribam",
    "districtName": "Jiribam",
    "stateId": "state-mn",
    "stateName": "Manipur",
    "centroid": [
      24.78,
      93.1
    ],
    "zoneIds": []
  },
  {
    "id": "city-shillong-ml-east-khasi-hills",
    "name": "Shillong",
    "type": "city",
    "districtId": "dist-ml-east-khasi-hills",
    "districtName": "East Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.5788,
      91.8933
    ],
    "zoneIds": [
      5
    ]
  },
  {
    "id": "city-cherrapunji-ml-east-khasi-hills",
    "name": "Cherrapunji",
    "type": "city",
    "districtId": "dist-ml-east-khasi-hills",
    "districtName": "East Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.2986,
      91.7317
    ],
    "zoneIds": [
      5
    ]
  },
  {
    "id": "city-sohra-ml-east-khasi-hills",
    "name": "Sohra",
    "type": "city",
    "districtId": "dist-ml-east-khasi-hills",
    "districtName": "East Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.28,
      91.73
    ],
    "zoneIds": [
      5
    ]
  },
  {
    "id": "city-mawsynram-ml-east-khasi-hills",
    "name": "Mawsynram",
    "type": "town",
    "districtId": "dist-ml-east-khasi-hills",
    "districtName": "East Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.3,
      91.58
    ],
    "zoneIds": [
      5
    ]
  },
  {
    "id": "city-laitumkhrah-ml-east-khasi-hills",
    "name": "Laitumkhrah",
    "type": "locality",
    "districtId": "dist-ml-east-khasi-hills",
    "districtName": "East Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.57,
      91.9
    ],
    "zoneIds": [
      5
    ]
  },
  {
    "id": "city-police-bazar-ml-east-khasi-hills",
    "name": "Police Bazar",
    "type": "locality",
    "districtId": "dist-ml-east-khasi-hills",
    "districtName": "East Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.58,
      91.88
    ],
    "zoneIds": [
      5
    ]
  },
  {
    "id": "city-mawlai-ml-east-khasi-hills",
    "name": "Mawlai",
    "type": "locality",
    "districtId": "dist-ml-east-khasi-hills",
    "districtName": "East Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.6,
      91.87
    ],
    "zoneIds": [
      5
    ]
  },
  {
    "id": "city-pynursla-ml-east-khasi-hills",
    "name": "Pynursla",
    "type": "town",
    "districtId": "dist-ml-east-khasi-hills",
    "districtName": "East Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.31,
      91.9
    ],
    "zoneIds": [
      5
    ]
  },
  {
    "id": "city-jowai-ml-west-jaintia-hills",
    "name": "Jowai",
    "type": "city",
    "districtId": "dist-ml-west-jaintia-hills",
    "districtName": "West Jaintia Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.45,
      92.2
    ],
    "zoneIds": [
      6
    ]
  },
  {
    "id": "city-thadlaskein-ml-west-jaintia-hills",
    "name": "Thadlaskein",
    "type": "town",
    "districtId": "dist-ml-west-jaintia-hills",
    "districtName": "West Jaintia Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.5,
      92.17
    ],
    "zoneIds": [
      6
    ]
  },
  {
    "id": "city-amlarem-ml-west-jaintia-hills",
    "name": "Amlarem",
    "type": "town",
    "districtId": "dist-ml-west-jaintia-hills",
    "districtName": "West Jaintia Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.28,
      92.1
    ],
    "zoneIds": [
      6
    ]
  },
  {
    "id": "city-dawki-ml-west-jaintia-hills",
    "name": "Dawki",
    "type": "town",
    "districtId": "dist-ml-west-jaintia-hills",
    "districtName": "West Jaintia Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.19,
      92.02
    ],
    "zoneIds": [
      6
    ]
  },
  {
    "id": "city-khliehriat-ml-east-jaintia-hills",
    "name": "Khliehriat",
    "type": "city",
    "districtId": "dist-ml-east-jaintia-hills",
    "districtName": "East Jaintia Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.35,
      92.37
    ],
    "zoneIds": []
  },
  {
    "id": "city-lad-rymbai-ml-east-jaintia-hills",
    "name": "Lad Rymbai",
    "type": "town",
    "districtId": "dist-ml-east-jaintia-hills",
    "districtName": "East Jaintia Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.32,
      92.35
    ],
    "zoneIds": []
  },
  {
    "id": "city-sutnga-ml-east-jaintia-hills",
    "name": "Sutnga",
    "type": "town",
    "districtId": "dist-ml-east-jaintia-hills",
    "districtName": "East Jaintia Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.38,
      92.43
    ],
    "zoneIds": []
  },
  {
    "id": "city-nongstoin-ml-west-khasi-hills",
    "name": "Nongstoin",
    "type": "city",
    "districtId": "dist-ml-west-khasi-hills",
    "districtName": "West Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.52,
      91.27
    ],
    "zoneIds": []
  },
  {
    "id": "city-mairang-ml-west-khasi-hills",
    "name": "Mairang",
    "type": "city",
    "districtId": "dist-ml-west-khasi-hills",
    "districtName": "West Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.57,
      91.63
    ],
    "zoneIds": []
  },
  {
    "id": "city-mawthadraishan-ml-west-khasi-hills",
    "name": "Mawthadraishan",
    "type": "town",
    "districtId": "dist-ml-west-khasi-hills",
    "districtName": "West Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.55,
      91.5
    ],
    "zoneIds": []
  },
  {
    "id": "city-kynshi-ml-west-khasi-hills",
    "name": "Kynshi",
    "type": "town",
    "districtId": "dist-ml-west-khasi-hills",
    "districtName": "West Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.52,
      91.57
    ],
    "zoneIds": []
  },
  {
    "id": "city-mawkyrwat-ml-south-west-khasi-hills",
    "name": "Mawkyrwat",
    "type": "city",
    "districtId": "dist-ml-south-west-khasi-hills",
    "districtName": "South West Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.37,
      91.45
    ],
    "zoneIds": []
  },
  {
    "id": "city-ranikor-ml-south-west-khasi-hills",
    "name": "Ranikor",
    "type": "town",
    "districtId": "dist-ml-south-west-khasi-hills",
    "districtName": "South West Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.22,
      91.25
    ],
    "zoneIds": []
  },
  {
    "id": "city-mairang-ml-eastern-west-khasi-hills",
    "name": "Mairang",
    "type": "city",
    "districtId": "dist-ml-eastern-west-khasi-hills",
    "districtName": "Eastern West Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.57,
      91.63
    ],
    "zoneIds": []
  },
  {
    "id": "city-mawthadraishan-ml-eastern-west-khasi-hills",
    "name": "Mawthadraishan",
    "type": "town",
    "districtId": "dist-ml-eastern-west-khasi-hills",
    "districtName": "Eastern West Khasi Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.55,
      91.5
    ],
    "zoneIds": []
  },
  {
    "id": "city-nongpoh-ml-ri-bhoi",
    "name": "Nongpoh",
    "type": "city",
    "districtId": "dist-ml-ri-bhoi",
    "districtName": "Ri-Bhoi",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.9,
      91.88
    ],
    "zoneIds": []
  },
  {
    "id": "city-byrnihat-ml-ri-bhoi",
    "name": "Byrnihat",
    "type": "town",
    "districtId": "dist-ml-ri-bhoi",
    "districtName": "Ri-Bhoi",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      26.05,
      91.87
    ],
    "zoneIds": []
  },
  {
    "id": "city-umsning-ml-ri-bhoi",
    "name": "Umsning",
    "type": "town",
    "districtId": "dist-ml-ri-bhoi",
    "districtName": "Ri-Bhoi",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.75,
      91.9
    ],
    "zoneIds": []
  },
  {
    "id": "city-umiam-ml-ri-bhoi",
    "name": "Umiam",
    "type": "locality",
    "districtId": "dist-ml-ri-bhoi",
    "districtName": "Ri-Bhoi",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.65,
      91.9
    ],
    "zoneIds": []
  },
  {
    "id": "city-williamnagar-ml-east-garo-hills",
    "name": "Williamnagar",
    "type": "city",
    "districtId": "dist-ml-east-garo-hills",
    "districtName": "East Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.6,
      90.62
    ],
    "zoneIds": []
  },
  {
    "id": "city-rongjeng-ml-east-garo-hills",
    "name": "Rongjeng",
    "type": "town",
    "districtId": "dist-ml-east-garo-hills",
    "districtName": "East Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.68,
      90.78
    ],
    "zoneIds": []
  },
  {
    "id": "city-songsak-ml-east-garo-hills",
    "name": "Songsak",
    "type": "town",
    "districtId": "dist-ml-east-garo-hills",
    "districtName": "East Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.7,
      90.6
    ],
    "zoneIds": []
  },
  {
    "id": "city-tura-ml-west-garo-hills",
    "name": "Tura",
    "type": "city",
    "districtId": "dist-ml-west-garo-hills",
    "districtName": "West Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.5144,
      90.2035
    ],
    "zoneIds": []
  },
  {
    "id": "city-phulbari-ml-west-garo-hills",
    "name": "Phulbari",
    "type": "town",
    "districtId": "dist-ml-west-garo-hills",
    "districtName": "West Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.88,
      90.03
    ],
    "zoneIds": []
  },
  {
    "id": "city-tikrikilla-ml-west-garo-hills",
    "name": "Tikrikilla",
    "type": "town",
    "districtId": "dist-ml-west-garo-hills",
    "districtName": "West Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.93,
      90.17
    ],
    "zoneIds": []
  },
  {
    "id": "city-dalu-ml-west-garo-hills",
    "name": "Dalu",
    "type": "town",
    "districtId": "dist-ml-west-garo-hills",
    "districtName": "West Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.23,
      90.22
    ],
    "zoneIds": []
  },
  {
    "id": "city-baghmara-ml-south-garo-hills",
    "name": "Baghmara",
    "type": "city",
    "districtId": "dist-ml-south-garo-hills",
    "districtName": "South Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.2,
      90.63
    ],
    "zoneIds": []
  },
  {
    "id": "city-gasuapara-ml-south-garo-hills",
    "name": "Gasuapara",
    "type": "town",
    "districtId": "dist-ml-south-garo-hills",
    "districtName": "South Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.18,
      90.52
    ],
    "zoneIds": []
  },
  {
    "id": "city-siju-ml-south-garo-hills",
    "name": "Siju",
    "type": "locality",
    "districtId": "dist-ml-south-garo-hills",
    "districtName": "South Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.35,
      90.7
    ],
    "zoneIds": []
  },
  {
    "id": "city-resubelpara-ml-north-garo-hills",
    "name": "Resubelpara",
    "type": "city",
    "districtId": "dist-ml-north-garo-hills",
    "districtName": "North Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.9,
      90.6
    ],
    "zoneIds": []
  },
  {
    "id": "city-mendipathar-ml-north-garo-hills",
    "name": "Mendipathar",
    "type": "town",
    "districtId": "dist-ml-north-garo-hills",
    "districtName": "North Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.93,
      90.65
    ],
    "zoneIds": []
  },
  {
    "id": "city-bajengdoba-ml-north-garo-hills",
    "name": "Bajengdoba",
    "type": "town",
    "districtId": "dist-ml-north-garo-hills",
    "districtName": "North Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.88,
      90.5
    ],
    "zoneIds": []
  },
  {
    "id": "city-ampati-ml-south-west-garo-hills",
    "name": "Ampati",
    "type": "city",
    "districtId": "dist-ml-south-west-garo-hills",
    "districtName": "South West Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.47,
      90.0
    ],
    "zoneIds": []
  },
  {
    "id": "city-mahendraganj-ml-south-west-garo-hills",
    "name": "Mahendraganj",
    "type": "town",
    "districtId": "dist-ml-south-west-garo-hills",
    "districtName": "South West Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.3,
      89.85
    ],
    "zoneIds": []
  },
  {
    "id": "city-betasing-ml-south-west-garo-hills",
    "name": "Betasing",
    "type": "town",
    "districtId": "dist-ml-south-west-garo-hills",
    "districtName": "South West Garo Hills",
    "stateId": "state-ml",
    "stateName": "Meghalaya",
    "centroid": [
      25.52,
      89.97
    ],
    "zoneIds": []
  },
  {
    "id": "city-aizawl-mz-aizawl",
    "name": "Aizawl",
    "type": "city",
    "districtId": "dist-mz-aizawl",
    "districtName": "Aizawl",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.7271,
      92.7176
    ],
    "zoneIds": [
      3
    ]
  },
  {
    "id": "city-bawngkawn-mz-aizawl",
    "name": "Bawngkawn",
    "type": "locality",
    "districtId": "dist-mz-aizawl",
    "districtName": "Aizawl",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.75,
      92.73
    ],
    "zoneIds": [
      3
    ]
  },
  {
    "id": "city-khatla-mz-aizawl",
    "name": "Khatla",
    "type": "locality",
    "districtId": "dist-mz-aizawl",
    "districtName": "Aizawl",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.72,
      92.71
    ],
    "zoneIds": [
      3
    ]
  },
  {
    "id": "city-durtlang-mz-aizawl",
    "name": "Durtlang",
    "type": "locality",
    "districtId": "dist-mz-aizawl",
    "districtName": "Aizawl",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.78,
      92.73
    ],
    "zoneIds": [
      3
    ]
  },
  {
    "id": "city-ramhlun-mz-aizawl",
    "name": "Ramhlun",
    "type": "locality",
    "districtId": "dist-mz-aizawl",
    "districtName": "Aizawl",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.74,
      92.72
    ],
    "zoneIds": [
      3
    ]
  },
  {
    "id": "city-sairang-mz-aizawl",
    "name": "Sairang",
    "type": "town",
    "districtId": "dist-mz-aizawl",
    "districtName": "Aizawl",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.8,
      92.65
    ],
    "zoneIds": [
      3
    ]
  },
  {
    "id": "city-lunglei-mz-lunglei",
    "name": "Lunglei",
    "type": "city",
    "districtId": "dist-mz-lunglei",
    "districtName": "Lunglei",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      22.8833,
      92.7333
    ],
    "zoneIds": [
      4
    ]
  },
  {
    "id": "city-tlabung-mz-lunglei",
    "name": "Tlabung",
    "type": "town",
    "districtId": "dist-mz-lunglei",
    "districtName": "Lunglei",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      22.9,
      92.48
    ],
    "zoneIds": [
      4
    ]
  },
  {
    "id": "city-hnahthial-mz-lunglei",
    "name": "Hnahthial",
    "type": "town",
    "districtId": "dist-mz-lunglei",
    "districtName": "Lunglei",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      22.97,
      92.93
    ],
    "zoneIds": [
      4
    ]
  },
  {
    "id": "city-champhai-mz-champhai",
    "name": "Champhai",
    "type": "city",
    "districtId": "dist-mz-champhai",
    "districtName": "Champhai",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.4756,
      93.3283
    ],
    "zoneIds": []
  },
  {
    "id": "city-zokhawthar-mz-champhai",
    "name": "Zokhawthar",
    "type": "town",
    "districtId": "dist-mz-champhai",
    "districtName": "Champhai",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.37,
      93.42
    ],
    "zoneIds": []
  },
  {
    "id": "city-khawbung-mz-champhai",
    "name": "Khawbung",
    "type": "town",
    "districtId": "dist-mz-champhai",
    "districtName": "Champhai",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.18,
      93.18
    ],
    "zoneIds": []
  },
  {
    "id": "city-kolasib-mz-kolasib",
    "name": "Kolasib",
    "type": "city",
    "districtId": "dist-mz-kolasib",
    "districtName": "Kolasib",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      24.23,
      92.68
    ],
    "zoneIds": []
  },
  {
    "id": "city-vairengte-mz-kolasib",
    "name": "Vairengte",
    "type": "town",
    "districtId": "dist-mz-kolasib",
    "districtName": "Kolasib",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      24.5,
      92.77
    ],
    "zoneIds": []
  },
  {
    "id": "city-bairabi-mz-kolasib",
    "name": "Bairabi",
    "type": "town",
    "districtId": "dist-mz-kolasib",
    "districtName": "Kolasib",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      24.18,
      92.53
    ],
    "zoneIds": []
  },
  {
    "id": "city-serchhip-mz-serchhip",
    "name": "Serchhip",
    "type": "city",
    "districtId": "dist-mz-serchhip",
    "districtName": "Serchhip",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.31,
      92.85
    ],
    "zoneIds": []
  },
  {
    "id": "city-thenzawl-mz-serchhip",
    "name": "Thenzawl",
    "type": "town",
    "districtId": "dist-mz-serchhip",
    "districtName": "Serchhip",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.28,
      92.75
    ],
    "zoneIds": []
  },
  {
    "id": "city-east-lungdar-mz-serchhip",
    "name": "East Lungdar",
    "type": "town",
    "districtId": "dist-mz-serchhip",
    "districtName": "Serchhip",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.12,
      92.98
    ],
    "zoneIds": []
  },
  {
    "id": "city-lawngtlai-mz-lawngtlai",
    "name": "Lawngtlai",
    "type": "city",
    "districtId": "dist-mz-lawngtlai",
    "districtName": "Lawngtlai",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      22.53,
      92.9
    ],
    "zoneIds": []
  },
  {
    "id": "city-chawngte-mz-lawngtlai",
    "name": "Chawngte",
    "type": "town",
    "districtId": "dist-mz-lawngtlai",
    "districtName": "Lawngtlai",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      22.65,
      92.65
    ],
    "zoneIds": []
  },
  {
    "id": "city-sangau-mz-lawngtlai",
    "name": "Sangau",
    "type": "town",
    "districtId": "dist-mz-lawngtlai",
    "districtName": "Lawngtlai",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      22.73,
      93.07
    ],
    "zoneIds": []
  },
  {
    "id": "city-mamit-mz-mamit",
    "name": "Mamit",
    "type": "city",
    "districtId": "dist-mz-mamit",
    "districtName": "Mamit",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.93,
      92.48
    ],
    "zoneIds": []
  },
  {
    "id": "city-zawlnuam-mz-mamit",
    "name": "Zawlnuam",
    "type": "town",
    "districtId": "dist-mz-mamit",
    "districtName": "Mamit",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      24.13,
      92.35
    ],
    "zoneIds": []
  },
  {
    "id": "city-west-phaileng-mz-mamit",
    "name": "West Phaileng",
    "type": "town",
    "districtId": "dist-mz-mamit",
    "districtName": "Mamit",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.65,
      92.45
    ],
    "zoneIds": []
  },
  {
    "id": "city-saiha-mz-saiha",
    "name": "Saiha",
    "type": "town",
    "districtId": "dist-mz-saiha",
    "districtName": "Saiha",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      22.49,
      92.98
    ],
    "zoneIds": []
  },
  {
    "id": "city-hnahthial-mz-hnahthial",
    "name": "Hnahthial",
    "type": "city",
    "districtId": "dist-mz-hnahthial",
    "districtName": "Hnahthial",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      22.97,
      92.93
    ],
    "zoneIds": []
  },
  {
    "id": "city-south-vanlaiphai-mz-hnahthial",
    "name": "South Vanlaiphai",
    "type": "town",
    "districtId": "dist-mz-hnahthial",
    "districtName": "Hnahthial",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.13,
      93.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-khawzawl-mz-khawzawl",
    "name": "Khawzawl",
    "type": "city",
    "districtId": "dist-mz-khawzawl",
    "districtName": "Khawzawl",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.53,
      93.18
    ],
    "zoneIds": []
  },
  {
    "id": "city-biate-mz-khawzawl",
    "name": "Biate",
    "type": "town",
    "districtId": "dist-mz-khawzawl",
    "districtName": "Khawzawl",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.18,
      93.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-saitual-mz-saitual",
    "name": "Saitual",
    "type": "city",
    "districtId": "dist-mz-saitual",
    "districtName": "Saitual",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.7,
      92.97
    ],
    "zoneIds": []
  },
  {
    "id": "city-ngopa-mz-saitual",
    "name": "Ngopa",
    "type": "town",
    "districtId": "dist-mz-saitual",
    "districtName": "Saitual",
    "stateId": "state-mz",
    "stateName": "Mizoram",
    "centroid": [
      23.88,
      93.2
    ],
    "zoneIds": []
  },
  {
    "id": "city-kohima-nl-kohima",
    "name": "Kohima",
    "type": "city",
    "districtId": "dist-nl-kohima",
    "districtName": "Kohima",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.6747,
      94.11
    ],
    "zoneIds": [
      7
    ]
  },
  {
    "id": "city-chiephobozou-nl-kohima",
    "name": "Chiephobozou",
    "type": "town",
    "districtId": "dist-nl-kohima",
    "districtName": "Kohima",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.8,
      94.15
    ],
    "zoneIds": [
      7
    ]
  },
  {
    "id": "city-jakhama-nl-kohima",
    "name": "Jakhama",
    "type": "town",
    "districtId": "dist-nl-kohima",
    "districtName": "Kohima",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.6,
      94.12
    ],
    "zoneIds": [
      7
    ]
  },
  {
    "id": "city-viswema-nl-kohima",
    "name": "Viswema",
    "type": "town",
    "districtId": "dist-nl-kohima",
    "districtName": "Kohima",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.55,
      94.15
    ],
    "zoneIds": [
      7
    ]
  },
  {
    "id": "city-kisama-nl-kohima",
    "name": "Kisama",
    "type": "locality",
    "districtId": "dist-nl-kohima",
    "districtName": "Kohima",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.62,
      94.11
    ],
    "zoneIds": [
      7
    ]
  },
  {
    "id": "city-dimapur-nl-dimapur",
    "name": "Dimapur",
    "type": "city",
    "districtId": "dist-nl-dimapur",
    "districtName": "Dimapur",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.9095,
      93.7267
    ],
    "zoneIds": [
      8
    ]
  },
  {
    "id": "city-chumukedima-nl-dimapur",
    "name": "Chumukedima",
    "type": "city",
    "districtId": "dist-nl-dimapur",
    "districtName": "Dimapur",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.82,
      93.77
    ],
    "zoneIds": [
      8
    ]
  },
  {
    "id": "city-medziphema-nl-dimapur",
    "name": "Medziphema",
    "type": "town",
    "districtId": "dist-nl-dimapur",
    "districtName": "Dimapur",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.75,
      93.85
    ],
    "zoneIds": [
      8
    ]
  },
  {
    "id": "city-purana-bazar-nl-dimapur",
    "name": "Purana Bazar",
    "type": "locality",
    "districtId": "dist-nl-dimapur",
    "districtName": "Dimapur",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.92,
      93.75
    ],
    "zoneIds": [
      8
    ]
  },
  {
    "id": "city-mokokchung-nl-mokokchung",
    "name": "Mokokchung",
    "type": "city",
    "districtId": "dist-nl-mokokchung",
    "districtName": "Mokokchung",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.3256,
      94.5292
    ],
    "zoneIds": []
  },
  {
    "id": "city-changtongya-nl-mokokchung",
    "name": "Changtongya",
    "type": "town",
    "districtId": "dist-nl-mokokchung",
    "districtName": "Mokokchung",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.55,
      94.68
    ],
    "zoneIds": []
  },
  {
    "id": "city-mangkolemba-nl-mokokchung",
    "name": "Mangkolemba",
    "type": "town",
    "districtId": "dist-nl-mokokchung",
    "districtName": "Mokokchung",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.38,
      94.33
    ],
    "zoneIds": []
  },
  {
    "id": "city-tuli-nl-mokokchung",
    "name": "Tuli",
    "type": "town",
    "districtId": "dist-nl-mokokchung",
    "districtName": "Mokokchung",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.7,
      94.65
    ],
    "zoneIds": []
  },
  {
    "id": "city-mon-nl-mon",
    "name": "Mon",
    "type": "city",
    "districtId": "dist-nl-mon",
    "districtName": "Mon",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.75,
      95.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-naginimora-nl-mon",
    "name": "Naginimora",
    "type": "town",
    "districtId": "dist-nl-mon",
    "districtName": "Mon",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.78,
      94.8
    ],
    "zoneIds": []
  },
  {
    "id": "city-tizit-nl-mon",
    "name": "Tizit",
    "type": "town",
    "districtId": "dist-nl-mon",
    "districtName": "Mon",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.9,
      95.05
    ],
    "zoneIds": []
  },
  {
    "id": "city-aboi-nl-mon",
    "name": "Aboi",
    "type": "town",
    "districtId": "dist-nl-mon",
    "districtName": "Mon",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.55,
      94.95
    ],
    "zoneIds": []
  },
  {
    "id": "city-tobu-nl-mon",
    "name": "Tobu",
    "type": "town",
    "districtId": "dist-nl-mon",
    "districtName": "Mon",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.4,
      95.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-phek-nl-phek",
    "name": "Phek",
    "type": "city",
    "districtId": "dist-nl-phek",
    "districtName": "Phek",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.68,
      94.5
    ],
    "zoneIds": []
  },
  {
    "id": "city-pf\u00fctsero-nl-phek",
    "name": "Pf\u00fctsero",
    "type": "city",
    "districtId": "dist-nl-phek",
    "districtName": "Phek",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.68,
      94.32
    ],
    "zoneIds": []
  },
  {
    "id": "city-chozuba-nl-phek",
    "name": "Chozuba",
    "type": "town",
    "districtId": "dist-nl-phek",
    "districtName": "Phek",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.78,
      94.35
    ],
    "zoneIds": []
  },
  {
    "id": "city-meluri-nl-phek",
    "name": "Meluri",
    "type": "town",
    "districtId": "dist-nl-phek",
    "districtName": "Phek",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.68,
      94.63
    ],
    "zoneIds": []
  },
  {
    "id": "city-tuensang-nl-tuensang",
    "name": "Tuensang",
    "type": "city",
    "districtId": "dist-nl-tuensang",
    "districtName": "Tuensang",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.28,
      94.83
    ],
    "zoneIds": []
  },
  {
    "id": "city-longkhim-nl-tuensang",
    "name": "Longkhim",
    "type": "town",
    "districtId": "dist-nl-tuensang",
    "districtName": "Tuensang",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.2,
      94.68
    ],
    "zoneIds": []
  },
  {
    "id": "city-noksen-nl-tuensang",
    "name": "Noksen",
    "type": "town",
    "districtId": "dist-nl-tuensang",
    "districtName": "Tuensang",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.38,
      94.82
    ],
    "zoneIds": []
  },
  {
    "id": "city-shamator-nl-tuensang",
    "name": "Shamator",
    "type": "town",
    "districtId": "dist-nl-tuensang",
    "districtName": "Tuensang",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.05,
      94.9
    ],
    "zoneIds": []
  },
  {
    "id": "city-wokha-nl-wokha",
    "name": "Wokha",
    "type": "city",
    "districtId": "dist-nl-wokha",
    "districtName": "Wokha",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.1,
      94.27
    ],
    "zoneIds": []
  },
  {
    "id": "city-bhandari-nl-wokha",
    "name": "Bhandari",
    "type": "town",
    "districtId": "dist-nl-wokha",
    "districtName": "Wokha",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.13,
      94.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-sanis-nl-wokha",
    "name": "Sanis",
    "type": "town",
    "districtId": "dist-nl-wokha",
    "districtName": "Wokha",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.23,
      94.17
    ],
    "zoneIds": []
  },
  {
    "id": "city-zunheboto-nl-zunheboto",
    "name": "Zunheboto",
    "type": "city",
    "districtId": "dist-nl-zunheboto",
    "districtName": "Zunheboto",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.97,
      94.52
    ],
    "zoneIds": []
  },
  {
    "id": "city-akuluto-nl-zunheboto",
    "name": "Akuluto",
    "type": "town",
    "districtId": "dist-nl-zunheboto",
    "districtName": "Zunheboto",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.12,
      94.53
    ],
    "zoneIds": []
  },
  {
    "id": "city-aghunato-nl-zunheboto",
    "name": "Aghunato",
    "type": "town",
    "districtId": "dist-nl-zunheboto",
    "districtName": "Zunheboto",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.95,
      94.68
    ],
    "zoneIds": []
  },
  {
    "id": "city-satakha-nl-zunheboto",
    "name": "Satakha",
    "type": "town",
    "districtId": "dist-nl-zunheboto",
    "districtName": "Zunheboto",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.88,
      94.48
    ],
    "zoneIds": []
  },
  {
    "id": "city-kiphire-nl-kiphire",
    "name": "Kiphire",
    "type": "city",
    "districtId": "dist-nl-kiphire",
    "districtName": "Kiphire",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.85,
      94.78
    ],
    "zoneIds": []
  },
  {
    "id": "city-pungro-nl-kiphire",
    "name": "Pungro",
    "type": "town",
    "districtId": "dist-nl-kiphire",
    "districtName": "Kiphire",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.77,
      94.88
    ],
    "zoneIds": []
  },
  {
    "id": "city-seyochung-nl-kiphire",
    "name": "Seyochung",
    "type": "town",
    "districtId": "dist-nl-kiphire",
    "districtName": "Kiphire",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.95,
      94.7
    ],
    "zoneIds": []
  },
  {
    "id": "city-longleng-nl-longleng",
    "name": "Longleng",
    "type": "city",
    "districtId": "dist-nl-longleng",
    "districtName": "Longleng",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.48,
      94.8
    ],
    "zoneIds": []
  },
  {
    "id": "city-tamlu-nl-longleng",
    "name": "Tamlu",
    "type": "town",
    "districtId": "dist-nl-longleng",
    "districtName": "Longleng",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.65,
      94.75
    ],
    "zoneIds": []
  },
  {
    "id": "city-peren-nl-peren",
    "name": "Peren",
    "type": "city",
    "districtId": "dist-nl-peren",
    "districtName": "Peren",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.52,
      93.73
    ],
    "zoneIds": []
  },
  {
    "id": "city-jalukie-nl-peren",
    "name": "Jalukie",
    "type": "city",
    "districtId": "dist-nl-peren",
    "districtName": "Peren",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.58,
      93.72
    ],
    "zoneIds": []
  },
  {
    "id": "city-tening-nl-peren",
    "name": "Tening",
    "type": "town",
    "districtId": "dist-nl-peren",
    "districtName": "Peren",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.3,
      93.6
    ],
    "zoneIds": []
  },
  {
    "id": "city-noklak-nl-noklak",
    "name": "Noklak",
    "type": "city",
    "districtId": "dist-nl-noklak",
    "districtName": "Noklak",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.2,
      95.02
    ],
    "zoneIds": []
  },
  {
    "id": "city-thonoknyu-nl-noklak",
    "name": "Thonoknyu",
    "type": "town",
    "districtId": "dist-nl-noklak",
    "districtName": "Noklak",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.12,
      95.0
    ],
    "zoneIds": []
  },
  {
    "id": "city-chumoukedima-nl-chumoukedima",
    "name": "Chumoukedima",
    "type": "town",
    "districtId": "dist-nl-chumoukedima",
    "districtName": "Chumoukedima",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.82,
      93.78
    ],
    "zoneIds": []
  },
  {
    "id": "city-niuland-nl-niuland",
    "name": "Niuland",
    "type": "city",
    "districtId": "dist-nl-niuland",
    "districtName": "Niuland",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.98,
      93.88
    ],
    "zoneIds": []
  },
  {
    "id": "city-tseminyu-nl-tseminyu",
    "name": "Tseminyu",
    "type": "city",
    "districtId": "dist-nl-tseminyu",
    "districtName": "Tseminyu",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      25.92,
      94.22
    ],
    "zoneIds": []
  },
  {
    "id": "city-shamator-nl-shamator",
    "name": "Shamator",
    "type": "city",
    "districtId": "dist-nl-shamator",
    "districtName": "Shamator",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.05,
      94.9
    ],
    "zoneIds": []
  },
  {
    "id": "city-chessore-nl-shamator",
    "name": "Chessore",
    "type": "town",
    "districtId": "dist-nl-shamator",
    "districtName": "Shamator",
    "stateId": "state-nl",
    "stateName": "Nagaland",
    "centroid": [
      26.12,
      94.92
    ],
    "zoneIds": []
  },
  {
    "id": "city-east-sikkim-(gangtok)-sk-east-sikkim",
    "name": "East Sikkim (Gangtok)",
    "type": "town",
    "districtId": "dist-sk-east-sikkim",
    "districtName": "East Sikkim (Gangtok)",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [
      27.33,
      88.61
    ],
    "zoneIds": [
      11
    ]
  },
  {
    "id": "city-mangan-(north-sikkim)-sk-mangan",
    "name": "Mangan (North Sikkim)",
    "type": "town",
    "districtId": "dist-sk-mangan",
    "districtName": "Mangan (North Sikkim)",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [
      27.51,
      88.53
    ],
    "zoneIds": [
      12
    ]
  },
  {
    "id": "city-namchi-(south-sikkim)-sk-namchi",
    "name": "Namchi (South Sikkim)",
    "type": "town",
    "districtId": "dist-sk-namchi",
    "districtName": "Namchi (South Sikkim)",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [
      27.17,
      88.36
    ],
    "zoneIds": []
  },
  {
    "id": "city-gyalshing-(west-sikkim)-sk-gyalshing",
    "name": "Gyalshing (West Sikkim)",
    "type": "town",
    "districtId": "dist-sk-gyalshing",
    "districtName": "Gyalshing (West Sikkim)",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [
      27.28,
      88.24
    ],
    "zoneIds": []
  },
  {
    "id": "city-pakyong-sk-pakyong",
    "name": "Pakyong",
    "type": "city",
    "districtId": "dist-sk-pakyong",
    "districtName": "Pakyong",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [
      27.23,
      88.6
    ],
    "zoneIds": []
  },
  {
    "id": "city-rhenock-sk-pakyong",
    "name": "Rhenock",
    "type": "town",
    "districtId": "dist-sk-pakyong",
    "districtName": "Pakyong",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [
      27.18,
      88.65
    ],
    "zoneIds": []
  },
  {
    "id": "city-rongli-sk-pakyong",
    "name": "Rongli",
    "type": "town",
    "districtId": "dist-sk-pakyong",
    "districtName": "Pakyong",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [
      27.2,
      88.7
    ],
    "zoneIds": []
  },
  {
    "id": "city-soreng-sk-soreng",
    "name": "Soreng",
    "type": "city",
    "districtId": "dist-sk-soreng",
    "districtName": "Soreng",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [
      27.17,
      88.2
    ],
    "zoneIds": []
  },
  {
    "id": "city-daramdin-sk-soreng",
    "name": "Daramdin",
    "type": "town",
    "districtId": "dist-sk-soreng",
    "districtName": "Soreng",
    "stateId": "state-sk",
    "stateName": "Sikkim",
    "centroid": [
      27.13,
      88.17
    ],
    "zoneIds": []
  },
  {
    "id": "city-ambassa-tr-dhalai",
    "name": "Ambassa",
    "type": "city",
    "districtId": "dist-tr-dhalai",
    "districtName": "Dhalai",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.92,
      91.85
    ],
    "zoneIds": [
      15
    ]
  },
  {
    "id": "city-kamalpur-tr-dhalai",
    "name": "Kamalpur",
    "type": "town",
    "districtId": "dist-tr-dhalai",
    "districtName": "Dhalai",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      24.2,
      91.83
    ],
    "zoneIds": [
      15
    ]
  },
  {
    "id": "city-gandacherra-tr-dhalai",
    "name": "Gandacherra",
    "type": "town",
    "districtId": "dist-tr-dhalai",
    "districtName": "Dhalai",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.75,
      91.95
    ],
    "zoneIds": [
      15
    ]
  },
  {
    "id": "city-longtharai-valley-tr-dhalai",
    "name": "Longtharai Valley",
    "type": "town",
    "districtId": "dist-tr-dhalai",
    "districtName": "Dhalai",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.88,
      91.9
    ],
    "zoneIds": [
      15
    ]
  },
  {
    "id": "city-agartala-tr-west-tripura",
    "name": "Agartala",
    "type": "city",
    "districtId": "dist-tr-west-tripura",
    "districtName": "West Tripura",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.8315,
      91.2868
    ],
    "zoneIds": []
  },
  {
    "id": "city-ranirbazar-tr-west-tripura",
    "name": "Ranirbazar",
    "type": "town",
    "districtId": "dist-tr-west-tripura",
    "districtName": "West Tripura",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.83,
      91.37
    ],
    "zoneIds": []
  },
  {
    "id": "city-mohanpur-tr-west-tripura",
    "name": "Mohanpur",
    "type": "town",
    "districtId": "dist-tr-west-tripura",
    "districtName": "West Tripura",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.97,
      91.37
    ],
    "zoneIds": []
  },
  {
    "id": "city-jirania-tr-west-tripura",
    "name": "Jirania",
    "type": "town",
    "districtId": "dist-tr-west-tripura",
    "districtName": "West Tripura",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.82,
      91.43
    ],
    "zoneIds": []
  },
  {
    "id": "city-belonia-tr-south-tripura",
    "name": "Belonia",
    "type": "city",
    "districtId": "dist-tr-south-tripura",
    "districtName": "South Tripura",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.25,
      91.45
    ],
    "zoneIds": []
  },
  {
    "id": "city-santirbazar-tr-south-tripura",
    "name": "Santirbazar",
    "type": "town",
    "districtId": "dist-tr-south-tripura",
    "districtName": "South Tripura",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.3,
      91.55
    ],
    "zoneIds": []
  },
  {
    "id": "city-sabroom-tr-south-tripura",
    "name": "Sabroom",
    "type": "town",
    "districtId": "dist-tr-south-tripura",
    "districtName": "South Tripura",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.0,
      91.73
    ],
    "zoneIds": []
  },
  {
    "id": "city-dharmanagar-tr-north-tripura",
    "name": "Dharmanagar",
    "type": "city",
    "districtId": "dist-tr-north-tripura",
    "districtName": "North Tripura",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      24.38,
      92.17
    ],
    "zoneIds": []
  },
  {
    "id": "city-panisagar-tr-north-tripura",
    "name": "Panisagar",
    "type": "town",
    "districtId": "dist-tr-north-tripura",
    "districtName": "North Tripura",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      24.27,
      92.15
    ],
    "zoneIds": []
  },
  {
    "id": "city-kanchanpur-tr-north-tripura",
    "name": "Kanchanpur",
    "type": "town",
    "districtId": "dist-tr-north-tripura",
    "districtName": "North Tripura",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.98,
      92.22
    ],
    "zoneIds": []
  },
  {
    "id": "city-udaipur-tr-gomati",
    "name": "Udaipur",
    "type": "city",
    "districtId": "dist-tr-gomati",
    "districtName": "Gomati",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.53,
      91.48
    ],
    "zoneIds": []
  },
  {
    "id": "city-amarpur-tr-gomati",
    "name": "Amarpur",
    "type": "town",
    "districtId": "dist-tr-gomati",
    "districtName": "Gomati",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.53,
      91.65
    ],
    "zoneIds": []
  },
  {
    "id": "city-karbook-tr-gomati",
    "name": "Karbook",
    "type": "town",
    "districtId": "dist-tr-gomati",
    "districtName": "Gomati",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.37,
      91.75
    ],
    "zoneIds": []
  },
  {
    "id": "city-khowai-tr-khowai",
    "name": "Khowai",
    "type": "city",
    "districtId": "dist-tr-khowai",
    "districtName": "Khowai",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      24.07,
      91.6
    ],
    "zoneIds": []
  },
  {
    "id": "city-teliamura-tr-khowai",
    "name": "Teliamura",
    "type": "town",
    "districtId": "dist-tr-khowai",
    "districtName": "Khowai",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.83,
      91.63
    ],
    "zoneIds": []
  },
  {
    "id": "city-bishramganj-tr-sepahijala",
    "name": "Bishramganj",
    "type": "city",
    "districtId": "dist-tr-sepahijala",
    "districtName": "Sepahijala",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.63,
      91.33
    ],
    "zoneIds": []
  },
  {
    "id": "city-sonamura-tr-sepahijala",
    "name": "Sonamura",
    "type": "town",
    "districtId": "dist-tr-sepahijala",
    "districtName": "Sepahijala",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.47,
      91.27
    ],
    "zoneIds": []
  },
  {
    "id": "city-japuijala-tr-sepahijala",
    "name": "Japuijala",
    "type": "town",
    "districtId": "dist-tr-sepahijala",
    "districtName": "Sepahijala",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      23.7,
      91.3
    ],
    "zoneIds": []
  },
  {
    "id": "city-kailashahar-tr-unakoti",
    "name": "Kailashahar",
    "type": "city",
    "districtId": "dist-tr-unakoti",
    "districtName": "Unakoti",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      24.33,
      92.0
    ],
    "zoneIds": []
  },
  {
    "id": "city-kumarghat-tr-unakoti",
    "name": "Kumarghat",
    "type": "town",
    "districtId": "dist-tr-unakoti",
    "districtName": "Unakoti",
    "stateId": "state-tr",
    "stateName": "Tripura",
    "centroid": [
      24.15,
      92.03
    ],
    "zoneIds": []
  }
];

export function getAllCities(): CityEntity[] {
  return NER_CITIES;
}

export function getCitiesByDistrict(districtId: string): CityEntity[] {
  return NER_CITIES.filter((c) => c.districtId === districtId);
}

export function getCitiesByState(stateNameOrId: string): CityEntity[] {
  const norm = stateNameOrId.trim().toLowerCase();
  return NER_CITIES.filter(
    (c) =>
      c.stateId.toLowerCase() === norm ||
      c.stateName.toLowerCase() === norm
  );
}

export function getCityById(id: string): CityEntity | undefined {
  return NER_CITIES.find((c) => c.id === id);
}

// 4. THE 15 OPERATIONAL TELEMETRY CLUSTERS / MONITORED SLOPE STATIONS
export const NER_MONITORED_ZONES: Record<number, MonitoredZoneEntity> = {
  1: {
    id: 1,
    districtId: "dist-mn-tamenglong",
    stateId: "state-mn",
    name: "Tamenglong",
    district: "Tamenglong",
    state: "Manipur",
    centroid_lat: 24.98,
    centroid_lng: 93.49,
    mean_slope_deg: 31.4,
    population: 51213,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "High",
    threshold_e_mm: 435.3,
  },
  2: {
    id: 2,
    districtId: "dist-mn-noney",
    stateId: "state-mn",
    name: "Noney",
    district: "Noney",
    state: "Manipur",
    centroid_lat: 24.81,
    centroid_lng: 93.62,
    mean_slope_deg: 38.2,
    population: 22840,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "High",
    threshold_e_mm: 412.0,
  },
  3: {
    id: 3,
    districtId: "dist-mz-aizawl",
    stateId: "state-mz",
    name: "Aizawl East",
    district: "Aizawl",
    state: "Mizoram",
    centroid_lat: 23.73,
    centroid_lng: 92.72,
    mean_slope_deg: 42.6,
    population: 74310,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Moderate",
    threshold_e_mm: 480.5,
  },
  4: {
    id: 4,
    districtId: "dist-mz-lunglei",
    stateId: "state-mz",
    name: "Lunglei Slopes",
    district: "Lunglei",
    state: "Mizoram",
    centroid_lat: 22.89,
    centroid_lng: 92.74,
    mean_slope_deg: 36.1,
    population: 31905,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Low",
    threshold_e_mm: 450.0,
  },
  5: {
    id: 5,
    districtId: "dist-ml-east-khasi-hills",
    stateId: "state-ml",
    name: "Shillong-Sohra Escarpment",
    district: "East Khasi Hills",
    state: "Meghalaya",
    centroid_lat: 25.43,
    centroid_lng: 91.73,
    mean_slope_deg: 45.8,
    population: 96420,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Severe",
    threshold_e_mm: 520.0,
  },
  6: {
    id: 6,
    districtId: "dist-ml-west-jaintia-hills",
    stateId: "state-ml",
    name: "Jaintia Hills Ridge",
    district: "West Jaintia Hills",
    state: "Meghalaya",
    centroid_lat: 25.45,
    centroid_lng: 92.20,
    mean_slope_deg: 33.7,
    population: 40118,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Moderate",
    threshold_e_mm: 470.0,
  },
  7: {
    id: 7,
    districtId: "dist-nl-kohima",
    stateId: "state-nl",
    name: "Kohima Ridge",
    district: "Kohima",
    state: "Nagaland",
    centroid_lat: 25.67,
    centroid_lng: 94.11,
    mean_slope_deg: 40.3,
    population: 68550,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "High",
    threshold_e_mm: 440.0,
  },
  8: {
    id: 8,
    districtId: "dist-nl-dimapur",
    stateId: "state-nl",
    name: "Dimapur Foothills",
    district: "Dimapur",
    state: "Nagaland",
    centroid_lat: 25.91,
    centroid_lng: 93.73,
    mean_slope_deg: 21.5,
    population: 88240,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Low",
    threshold_e_mm: 390.0,
  },
  9: {
    id: 9,
    districtId: "dist-ar-papum-pare",
    stateId: "state-ar",
    name: "Papum Pare",
    district: "Papum Pare",
    state: "Arunachal Pradesh",
    centroid_lat: 27.15,
    centroid_lng: 93.58,
    mean_slope_deg: 29.9,
    population: 35760,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Moderate",
    threshold_e_mm: 460.0,
  },
  10: {
    id: 10,
    districtId: "dist-ar-dibang-valley",
    stateId: "state-ar",
    name: "Dibang Valley",
    district: "Dibang Valley",
    state: "Arunachal Pradesh",
    centroid_lat: 28.32,
    centroid_lng: 95.84,
    mean_slope_deg: 47.2,
    population: 9130,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Severe",
    threshold_e_mm: 510.0,
  },
  11: {
    id: 11,
    districtId: "dist-sk-east-sikkim",
    stateId: "state-sk",
    name: "Gangtok-Singtam Corridor",
    district: "East Sikkim (Gangtok)",
    state: "Sikkim",
    centroid_lat: 27.28,
    centroid_lng: 88.55,
    mean_slope_deg: 44.1,
    population: 58970,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "High",
    threshold_e_mm: 495.0,
  },
  12: {
    id: 12,
    districtId: "dist-sk-mangan",
    stateId: "state-sk",
    name: "Mangan North",
    district: "Mangan (North Sikkim)",
    state: "Sikkim",
    centroid_lat: 27.51,
    centroid_lng: 88.53,
    mean_slope_deg: 48.6,
    population: 12480,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Severe",
    threshold_e_mm: 530.0,
  },
  13: {
    id: 13,
    districtId: "dist-as-dima-hasao",
    stateId: "state-as",
    name: "Haflong Hills",
    district: "Dima Hasao",
    state: "Assam",
    centroid_lat: 25.17,
    centroid_lng: 93.02,
    mean_slope_deg: 34.8,
    population: 27615,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Moderate",
    threshold_e_mm: 445.0,
  },
  14: {
    id: 14,
    districtId: "dist-as-karbi-anglong",
    stateId: "state-as",
    name: "Karbi Anglong West",
    district: "Karbi Anglong",
    state: "Assam",
    centroid_lat: 25.90,
    centroid_lng: 93.35,
    mean_slope_deg: 27.3,
    population: 43190,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Low",
    threshold_e_mm: 410.0,
  },
  15: {
    id: 15,
    districtId: "dist-tr-dhalai",
    stateId: "state-tr",
    name: "Ambassa Hills",
    district: "Dhalai",
    state: "Tripura",
    centroid_lat: 23.92,
    centroid_lng: 91.85,
    mean_slope_deg: 24.1,
    population: 34820,
    monitoring_status: "ACTIVE_TELEMETRY",
    default_risk_level: "Low",
    threshold_e_mm: 380.0,
  },
};

// 5. HELPER & QUERY FUNCTIONS

/** Returns the root North Eastern Region */
export function getRegion(): RegionEntity {
  return NORTH_EASTERN_REGION;
}

/** Returns all 8 NER states */
export function getAllStates(): StateEntity[] {
  return Object.values(NER_STATES);
}

/** Returns a state by unique ID (e.g. 'state-as') or state code ('AS') */
export function getStateById(stateId: string): StateEntity | undefined {
  if (NER_STATES[stateId]) return NER_STATES[stateId];
  return Object.values(NER_STATES).find(
    (s) => s.code.toLowerCase() === stateId.toLowerCase() || s.name.toLowerCase() === stateId.toLowerCase(),
  );
}

/** Returns a state by display name */
export function getStateByName(name: string): StateEntity | undefined {
  const norm = name.trim().toLowerCase();
  return Object.values(NER_STATES).find((s) => s.name.toLowerCase() === norm);
}

/** Returns all districts in the North-Eastern Region */
export function getAllDistricts(): DistrictEntity[] {
  return Object.values(NER_DISTRICTS);
}

/** Returns all districts in a given state */
export function getDistrictsByState(stateIdOrName: string): DistrictEntity[] {
  const state = getStateById(stateIdOrName) || getStateByName(stateIdOrName);
  if (!state) return [];
  return state.districtIds.map((id) => NER_DISTRICTS[id]!).filter(Boolean);
}

/** Returns a district by unique ID */
export function getDistrictById(districtId: string): DistrictEntity | undefined {
  return NER_DISTRICTS[districtId];
}

/** Returns a district by display name and optional state name */
export function getDistrictByName(name: string, stateName?: string): DistrictEntity | undefined {
  const norm = name.trim().toLowerCase();
  const allMatches = Object.values(NER_DISTRICTS).filter(
    (d) => d.name.toLowerCase() === norm || d.name.toLowerCase().includes(norm),
  );
  if (stateName) {
    const sNorm = stateName.trim().toLowerCase();
    return allMatches.find((d) => d.stateName.toLowerCase() === sNorm) ?? allMatches[0];
  }
  return allMatches[0];
}

/** Returns all operational monitored risk zones in a district */
export function getZonesByDistrict(districtIdOrName: string): MonitoredZoneEntity[] {
  const district = getDistrictById(districtIdOrName) || getDistrictByName(districtIdOrName);
  if (!district) return [];
  return district.zoneIds.map((id) => NER_MONITORED_ZONES[id]!).filter(Boolean);
}

/** Returns all operational monitored risk zones in a state */
export function getZonesByState(stateIdOrName: string): MonitoredZoneEntity[] {
  const state = getStateById(stateIdOrName) || getStateByName(stateIdOrName);
  if (!state) return [];
  return Object.values(NER_MONITORED_ZONES).filter((z) => z.stateId === state.id);
}

/** Returns a monitored zone by numeric ID (1-15) */
export function getZoneById(zoneId: number): MonitoredZoneEntity | undefined {
  return NER_MONITORED_ZONES[zoneId];
}

/** Returns all operational monitored zones */
export function getAllZones(): MonitoredZoneEntity[] {
  return Object.values(NER_MONITORED_ZONES);
}

/** Returns the full nested hierarchy tree: Region -> States -> Districts -> MonitoredZones */
export function getCompleteHierarchy() {
  const region = getRegion();
  const states = getAllStates().map((state) => {
    const districts = getDistrictsByState(state.id).map((dist) => {
      const zones = getZonesByDistrict(dist.id);
      return {
        ...dist,
        zones,
      };
    });
    return {
      ...state,
      districts,
    };
  });

  return {
    region,
    states,
    totalStates: states.length,
    totalDistricts: Object.keys(NER_DISTRICTS).length,
    totalMonitoredZones: Object.keys(NER_MONITORED_ZONES).length,
  };
}

/** Great-circle distance between two coordinates in kilometers (Haversine formula) */
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface GpsLocationResolution {
  state: StateEntity;
  district: DistrictEntity;
  zone: MonitoredZoneEntity | null;
  isExactZone: boolean;
  distanceToZoneKm?: number;
  message: string;
}

/**
 * Resolves GPS latitude and longitude into structured State -> District -> Zone.
 * Never fabricates a monitored zone if the coordinates are not within the proximity
 * threshold (25 km) of an active telemetry monitoring station.
 */
export function resolveLocationFromGps(lat: number, lng: number): GpsLocationResolution {
  // 1. Find closest state by centroid distance
  const states = getAllStates();
  let closestState = states[0]!;
  let minStateDist = haversineDistanceKm(lat, lng, closestState.centroid[0], closestState.centroid[1]);

  for (const s of states) {
    const dist = haversineDistanceKm(lat, lng, s.centroid[0], s.centroid[1]);
    if (dist < minStateDist) {
      minStateDist = dist;
      closestState = s;
    }
  }

  // 2. Find closest district in that state
  const stateDistricts = getDistrictsByState(closestState.id);
  let closestDistrict = stateDistricts[0]!;
  let minDistDist = Infinity;

  for (const d of stateDistricts) {
    const dist = haversineDistanceKm(lat, lng, d.centroid[0], d.centroid[1]);
    if (dist < minDistDist) {
      minDistDist = dist;
      closestDistrict = d;
    }
  }

  // Also check all districts across NER in case coordinates are near border of another state
  const allDistricts = Object.values(NER_DISTRICTS);
  for (const d of allDistricts) {
    const dist = haversineDistanceKm(lat, lng, d.centroid[0], d.centroid[1]);
    if (dist < minDistDist) {
      minDistDist = dist;
      closestDistrict = d;
      const matchingState = getStateById(d.stateId);
      if (matchingState) closestState = matchingState;
    }
  }

  // 3. Find closest monitored zone within 25 km threshold
  const zones = getAllZones();
  let closestZone: MonitoredZoneEntity | null = null;
  let minZoneDist = Infinity;

  for (const z of zones) {
    const dist = haversineDistanceKm(lat, lng, z.centroid_lat, z.centroid_lng);
    if (dist < minZoneDist) {
      minZoneDist = dist;
      closestZone = z;
    }
  }

  const ZONE_PROXIMITY_THRESHOLD_KM = 25.0;

  if (closestZone && minZoneDist <= ZONE_PROXIMITY_THRESHOLD_KM) {
    const zoneDist = getDistrictById(closestZone.districtId);
    const zoneState = getStateById(closestZone.stateId);
    return {
      state: zoneState || closestState,
      district: zoneDist || closestDistrict,
      zone: closestZone,
      isExactZone: true,
      distanceToZoneKm: Math.round(minZoneDist * 10) / 10,
      message: `Proximity match: Zone ${closestZone.id} (${closestZone.name}) within ${minZoneDist.toFixed(1)} km.`,
    };
  }

  // If outside known telemetry clusters, return State and District but leave zone as NULL
  return {
    state: closestState,
    district: closestDistrict,
    zone: null,
    isExactZone: false,
    message: "Location captured. Exact monitored zone could not be determined.",
  };
}

export interface SearchResultItem {
  type: "region" | "state" | "district" | "city" | "town" | "locality" | "zone";
  id: string | number;
  name: string;
  stateName?: string | undefined;
  districtName?: string | undefined;
  centroid: [number, number];
  zoneId?: number | undefined;
  description: string;
}

/**
 * Searches across the geographic hierarchy for states, districts, cities/towns/localities, and monitored zones.
 * Case-insensitive, whitespace-tolerant, handles partial matching across all 8 NER states.
 */
export function searchGeography(query: string): SearchResultItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SearchResultItem[] = [];

  // Check Root Region
  if (
    NORTH_EASTERN_REGION.name.toLowerCase().includes(q) ||
    NORTH_EASTERN_REGION.code.toLowerCase() === q ||
    "north east".includes(q) ||
    "northeastern".includes(q)
  ) {
    results.push({
      type: "region",
      id: NORTH_EASTERN_REGION.id,
      name: NORTH_EASTERN_REGION.name,
      centroid: NORTH_EASTERN_REGION.centroid,
      description: "Root Coverage Region (8 States)",
    });
  }

  // Check States
  for (const state of getAllStates()) {
    if (state.name.toLowerCase().includes(q) || state.code.toLowerCase() === q) {
      results.push({
        type: "state",
        id: state.id,
        name: state.name,
        centroid: state.centroid,
        description: `State (${state.districtCount} districts)`,
      });
    }
  }

  // Check Cities / Towns / Localities across all 8 states
  for (const city of NER_CITIES) {
    if (
      city.name.toLowerCase().includes(q) ||
      `${city.name.toLowerCase()} ${city.districtName.toLowerCase()}`.includes(q) ||
      `${city.name.toLowerCase()} ${city.stateName.toLowerCase()}`.includes(q)
    ) {
      const activeZone = city.zoneIds.length > 0 ? city.zoneIds[0] : undefined;
      results.push({
        type: city.type,
        id: city.id,
        name: city.name,
        stateName: city.stateName,
        districtName: city.districtName,
        centroid: city.centroid,
        zoneId: activeZone,
        description: `${city.type === "city" ? "City" : city.type === "town" ? "Town" : "Locality"} · ${city.districtName}, ${city.stateName}${activeZone ? ` (Zone ${activeZone} active)` : ""}`,
      });
    }
  }

  // Check Districts
  for (const dist of Object.values(NER_DISTRICTS)) {
    if (dist.name.toLowerCase().includes(q) || `${dist.name.toLowerCase()} district`.includes(q)) {
      results.push({
        type: "district",
        id: dist.id,
        name: dist.name,
        stateName: dist.stateName,
        centroid: dist.centroid,
        zoneId: dist.zoneIds.length > 0 ? dist.zoneIds[0] : undefined,
        description: `District · ${dist.stateName}${dist.zoneIds.length > 0 ? ` (${dist.zoneIds.length} telemetry station)` : " (Regional coverage)"}`,
      });
    }
  }

  // Check Monitored Zones
  for (const zone of getAllZones()) {
    if (
      zone.name.toLowerCase().includes(q) ||
      `zone ${zone.id}`.includes(q) ||
      `zone-${zone.id}`.includes(q)
    ) {
      results.push({
        type: "zone",
        id: zone.id,
        name: zone.name,
        stateName: zone.state,
        districtName: zone.district,
        centroid: [zone.centroid_lat, zone.centroid_lng],
        zoneId: zone.id,
        description: `Monitored Zone #${zone.id} · ${zone.district}, ${zone.state}`,
      });
    }
  }

  // Deduplicate and cap results at reasonable size, prioritizing exact/starts-with matches
  const sorted = results.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(q) ? -1 : 1;
    const bStarts = b.name.toLowerCase().startsWith(q) ? -1 : 1;
    return aStarts - bStarts;
  });

  return sorted.slice(0, 30);
}
