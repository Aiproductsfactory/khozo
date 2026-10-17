/**
 * India's 28 states and 8 union territories, with the codes and names Khozo
 * routes on.
 *
 *   code  LGD state code (Local Government Directory, Ministry of Panchayati
 *         Raj), as a string: "24" is Gujarat, "27" Maharashtra. Stable across
 *         renames, and the same code the census 2011 used for every state that
 *         existed then.
 *   iso   ISO 3166-2:IN subdivision code without the "IN-" prefix. `isoAlt`
 *         holds the codes ISO withdrew (OpenStreetMap still returns some).
 *   name  English name, as Khozo has always stored it.
 *   gu/hi/mr  The name in Gujarati, Hindi and Marathi.
 *   aliases   Other spellings: old names, LGD's local-language names, the
 *             forms OpenStreetMap returns.
 *
 * Sources: LGD state list as published in the ramSeraph/opendata LGD archive
 * (states.15Oct2026.csv, fetched 17 Oct 2026); Gujarati, Hindi and Marathi
 * labels from Wikidata (LGD state code property P12747, queried 17 Oct 2026),
 * checked by hand. See scripts/build-gazetteer.mjs for the district data.
 *
 * Small and dependency-light on purpose: the web app bundles it, so the
 * sighting form can offer the state list with no network.
 */

import { editDistance, fuzzyAllowance, geoKey } from './normalise.js';

export const STATES = [
  { code: '35', iso: 'AN', type: 'ut', name: 'Andaman and Nicobar Islands', gu: 'આંદામાન અને નિકોબાર ટાપુઓ', hi: 'अंडमान और निकोबार द्वीपसमूह', mr: 'अंदमान आणि निकोबार बेटे', aliases: ['Andaman and Nicobar', 'Andaman & Nicobar Islands', 'Andaman', 'A&N Islands', 'अण्डमान और निकोबार द्वीपसमूह', 'અંદામાન અને નિકોબાર દ્વીપસમૂહ', 'अंदमान आणि निकोबार'] },
  { code: '28', iso: 'AP', type: 'state', name: 'Andhra Pradesh', gu: 'આંધ્ર પ્રદેશ', hi: 'आंध्र प्रदेश', mr: 'आंध्र प्रदेश', aliases: ['आन्ध्र प्रदेश', 'ఆంధ్ర ప్రదేశ్'] },
  { code: '12', iso: 'AR', type: 'state', name: 'Arunachal Pradesh', gu: 'અરુણાચલ પ્રદેશ', hi: 'अरुणाचल प्रदेश', mr: 'अरुणाचल प्रदेश', aliases: [] },
  { code: '18', iso: 'AS', type: 'state', name: 'Assam', gu: 'આસામ', hi: 'असम', mr: 'आसाम', aliases: ['অসম'] },
  { code: '10', iso: 'BR', type: 'state', name: 'Bihar', gu: 'બિહાર', hi: 'बिहार', mr: 'बिहार', aliases: [] },
  { code: '4', iso: 'CH', type: 'ut', name: 'Chandigarh', gu: 'ચંડીગઢ', hi: 'चंडीगढ़', mr: 'चंदीगड', aliases: ['ਚੰਡੀਗੜ੍ਹ'] },
  { code: '22', iso: 'CG', isoAlt: ['CT'], type: 'state', name: 'Chhattisgarh', gu: 'છત્તીસગઢ', hi: 'छत्तीसगढ़', mr: 'छत्तीसगड', aliases: ['Chattisgarh', 'Chhatisgarh'] },
  { code: '38', iso: 'DH', isoAlt: ['DN', 'DD'], type: 'ut', name: 'Dadra and Nagar Haveli and Daman and Diu', gu: 'દાદરા અને નગર હવેલી અને દમણ અને દીવ', hi: 'दादरा और नगर हवेली और दमन और दीव', mr: 'दादरा आणि नगर हवेली आणि दमण आणि दीव', aliases: ['The Dadra and Nagar Haveli and Daman and Diu', 'Dadra and Nagar Haveli', 'Daman and Diu', 'DNH and DD', 'दादरा व नगर हवेली आणि दमण व दीव'] },
  { code: '7', iso: 'DL', type: 'ut', name: 'Delhi', gu: 'દિલ્હી', hi: 'दिल्ली', mr: 'दिल्ली', aliases: ['New Delhi', 'NCT of Delhi', 'National Capital Territory of Delhi', 'Delhi NCR', 'राष्ट्रीय राजधानी क्षेत्र दिल्ली'] },
  { code: '30', iso: 'GA', type: 'state', name: 'Goa', gu: 'ગોવા', hi: 'गोवा', mr: 'गोवा', aliases: [] },
  { code: '24', iso: 'GJ', type: 'state', name: 'Gujarat', gu: 'ગુજરાત', hi: 'गुजरात', mr: 'गुजरात', aliases: ['Gujrat', 'Gujarath'] },
  { code: '6', iso: 'HR', type: 'state', name: 'Haryana', gu: 'હરિયાણા', hi: 'हरियाणा', mr: 'हरियाणा', aliases: [] },
  { code: '2', iso: 'HP', type: 'state', name: 'Himachal Pradesh', gu: 'હિમાચલ પ્રદેશ', hi: 'हिमाचल प्रदेश', mr: 'हिमाचल प्रदेश', aliases: [] },
  { code: '1', iso: 'JK', type: 'ut', name: 'Jammu and Kashmir', gu: 'જમ્મુ અને કાશ્મીર', hi: 'जम्मू और कश्मीर', mr: 'जम्मू आणि काश्मीर', aliases: ['Jammu & Kashmir', 'J&K', 'Jammu and Kashmir Union Territory'] },
  { code: '20', iso: 'JH', type: 'state', name: 'Jharkhand', gu: 'ઝારખંડ', hi: 'झारखंड', mr: 'झारखंड', aliases: ['झारखण्ड'] },
  { code: '29', iso: 'KA', type: 'state', name: 'Karnataka', gu: 'કર્ણાટક', hi: 'कर्नाटक', mr: 'कर्नाटक', aliases: ['ಕರ್ನಾಟಕ'] },
  { code: '32', iso: 'KL', type: 'state', name: 'Kerala', gu: 'કેરળ', hi: 'केरल', mr: 'केरळ', aliases: ['കേരളം'] },
  { code: '37', iso: 'LA', type: 'ut', name: 'Ladakh', gu: 'લદ્દાખ', hi: 'लद्दाख', mr: 'लडाख', aliases: ['लद्दाख़', 'લડાખ'] },
  { code: '31', iso: 'LD', type: 'ut', name: 'Lakshadweep', gu: 'લક્ષદ્વીપ', hi: 'लक्षद्वीप', mr: 'लक्षद्वीप', aliases: [] },
  { code: '23', iso: 'MP', type: 'state', name: 'Madhya Pradesh', gu: 'મધ્ય પ્રદેશ', hi: 'मध्य प्रदेश', mr: 'मध्य प्रदेश', aliases: [] },
  { code: '27', iso: 'MH', type: 'state', name: 'Maharashtra', gu: 'મહારાષ્ટ્ર', hi: 'महाराष्ट्र', mr: 'महाराष्ट्र', aliases: ['Maharastra', 'Maharashtra State'] },
  { code: '14', iso: 'MN', type: 'state', name: 'Manipur', gu: 'મણિપુર', hi: 'मणिपुर', mr: 'मणिपूर', aliases: [] },
  { code: '17', iso: 'ML', type: 'state', name: 'Meghalaya', gu: 'મેઘાલય', hi: 'मेघालय', mr: 'मेघालय', aliases: [] },
  { code: '15', iso: 'MZ', type: 'state', name: 'Mizoram', gu: 'મિઝોરમ', hi: 'मिज़ोरम', mr: 'मिझोरम', aliases: [] },
  { code: '13', iso: 'NL', type: 'state', name: 'Nagaland', gu: 'નાગાલેન્ડ', hi: 'नागालैंड', mr: 'नागालँड', aliases: ['नागालैण्ड', 'નાગાલેંડ'] },
  { code: '21', iso: 'OD', isoAlt: ['OR'], type: 'state', name: 'Odisha', gu: 'ઓડિશા', hi: 'ओडिशा', mr: 'ओडिशा', aliases: ['Orissa', 'ଓଡ଼ିଶା', 'ઑડિશા', 'उड़ीसा'] },
  { code: '34', iso: 'PY', type: 'ut', name: 'Puducherry', gu: 'પુડુચેરી', hi: 'पुडुचेरी', mr: 'पुदुच्चेरी', aliases: ['Pondicherry', 'पुदुचेरी', 'પુદુચેરી'] },
  { code: '3', iso: 'PB', type: 'state', name: 'Punjab', gu: 'પંજાબ', hi: 'पंजाब', mr: 'पंजाब', aliases: ['ਪੰਜਾਬ'] },
  { code: '8', iso: 'RJ', type: 'state', name: 'Rajasthan', gu: 'રાજસ્થાન', hi: 'राजस्थान', mr: 'राजस्थान', aliases: [] },
  { code: '11', iso: 'SK', type: 'state', name: 'Sikkim', gu: 'સિક્કિમ', hi: 'सिक्किम', mr: 'सिक्कीम', aliases: [] },
  { code: '33', iso: 'TN', type: 'state', name: 'Tamil Nadu', gu: 'તમિલનાડુ', hi: 'तमिलनाडु', mr: 'तमिळनाडू', aliases: ['Tamilnadu', 'तमिल नाडु', 'தமிழ்நாடு'] },
  { code: '36', iso: 'TS', isoAlt: ['TG'], type: 'state', name: 'Telangana', gu: 'તેલંગાણા', hi: 'तेलंगाना', mr: 'तेलंगणा', aliases: ['తెలంగాణ'] },
  { code: '16', iso: 'TR', type: 'state', name: 'Tripura', gu: 'ત્રિપુરા', hi: 'त्रिपुरा', mr: 'त्रिपुरा', aliases: ['ত্রিপুরা'] },
  { code: '9', iso: 'UP', type: 'state', name: 'Uttar Pradesh', gu: 'ઉત્તર પ્રદેશ', hi: 'उत्तर प्रदेश', mr: 'उत्तर प्रदेश', aliases: [] },
  { code: '5', iso: 'UK', isoAlt: ['UT'], type: 'state', name: 'Uttarakhand', gu: 'ઉત્તરાખંડ', hi: 'उत्तराखंड', mr: 'उत्तराखंड', aliases: ['Uttaranchal', 'उत्तराखण्ड'] },
  { code: '19', iso: 'WB', type: 'state', name: 'West Bengal', gu: 'પશ્ચિમ બંગાળ', hi: 'पश्चिम बंगाल', mr: 'पश्चिम बंगाल', aliases: ['Bengal', 'পশ্চিমবঙ্গ'] },
];

export const LANGUAGES = ['en', 'gu', 'hi', 'mr'];

const BY_CODE = new Map(STATES.map((state) => [state.code, state]));

/** A state's key without "state" or "union territory" around it. */
function stateKey(value) {
  const key = geoKey(value);
  const trimmed = key.replace(/^(?:stateof|unionterritoryof)/, '').replace(/(?:state|unionterritory)$/, '');
  return trimmed || key;
}

let index = null;

/** key -> state code; built on first use. */
function stateIndex() {
  if (index) return index;
  const exact = new Map();
  const put = (text, code) => {
    const key = stateKey(text);
    if (!key) return;
    const held = exact.get(key);
    if (held && held !== code) exact.set(key, null);
    else exact.set(key, code);
  };
  for (const state of STATES) {
    for (const text of [state.name, state.gu, state.hi, state.mr, ...state.aliases]) put(text, state.code);
  }
  index = { exact, keys: [...exact.entries()].filter(([, code]) => code) };
  return index;
}

/** The public shape of a state: `{ code, name }` plus its other names. */
function stateView(state) {
  return { code: state.code, name: state.name, iso: state.iso, type: state.type };
}

/** The state for an LGD code, or null. */
export function stateByCode(code) {
  const state = BY_CODE.get(String(code ?? '').trim());
  return state ? stateView(state) : null;
}

/**
 * Resolves what someone wrote for a state: any script, any case, extra
 * spaces or punctuation, an LGD code ("24"), an ISO code ("GJ", "IN-GJ"), an
 * old name ("Orissa"), or a near spelling ("Gujrat"). Returns
 * `{ code, name, iso, type }` or null when it cannot say which state.
 */
export function resolveState(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  if (/^\d{1,2}$/.test(raw)) return stateByCode(String(Number(raw)));
  const iso = raw.toUpperCase().replace(/^IN[-_ ]?/, '');
  if (/^[A-Z]{2}$/.test(iso)) {
    const byIso = STATES.find((s) => s.iso === iso || s.isoAlt?.includes(iso));
    if (byIso) return stateView(byIso);
  }
  const key = stateKey(raw);
  if (!key) return null;
  const { exact, keys } = stateIndex();
  if (exact.has(key)) return exact.get(key) ? stateByCode(exact.get(key)) : null;
  const allowance = fuzzyAllowance(key);
  if (!allowance) return null;
  let best = null;
  let bestDistance = allowance + 1;
  let tied = false;
  for (const [candidate, code] of keys) {
    // A misspelling keeps its first letter.
    if (candidate[0] !== key[0]) continue;
    const distance = editDistance(key, candidate, allowance);
    if (distance < bestDistance) {
      best = code;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance && code !== best) {
      tied = true;
    }
  }
  return best && !tied && bestDistance <= allowance ? stateByCode(best) : null;
}

/** A state's name in `lang` (en, gu, hi, mr), falling back to English. */
export function stateName(code, lang = 'en') {
  const state = BY_CODE.get(String(code ?? ''));
  if (!state) return null;
  return (lang !== 'en' && state[lang]) || state.name;
}

/** Every state and UT with its names in all four languages, for a picker. */
export function listStates() {
  return STATES.map((state) => ({
    ...stateView(state),
    names: { en: state.name, gu: state.gu, hi: state.hi, mr: state.mr },
  }));
}
