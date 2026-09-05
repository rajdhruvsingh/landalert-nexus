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
  type: "region" | "state" | "district" | "zone";
  id: string | number;
  name: string;
  stateName?: string;
  districtName?: string;
  centroid: [number, number];
  zoneId?: number;
  description: string;
}

/**
 * Searches across the geographic hierarchy for states, districts, and monitored zones.
 */
export function searchGeography(query: string): SearchResultItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SearchResultItem[] = [];

  // Check Root Region
  if (
    NORTH_EASTERN_REGION.name.toLowerCase().includes(q) ||
    NORTH_EASTERN_REGION.code.toLowerCase() === q ||
    "north east".includes(q)
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

  // Check Districts
  for (const dist of Object.values(NER_DISTRICTS)) {
    if (dist.name.toLowerCase().includes(q)) {
      results.push({
        type: "district",
        id: dist.id,
        name: dist.name,
        stateName: dist.stateName,
        centroid: dist.centroid,
        description: `District in ${dist.stateName}${dist.zoneIds.length > 0 ? ` (${dist.zoneIds.length} monitored zone)` : ""}`,
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

  return results;
}
