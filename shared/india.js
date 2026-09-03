/**
 * Indian administrative reference data.
 *
 * Its own module, with no Node imports, so the web app and the React Native app
 * can bundle it alongside the API. Jurisdiction routing depends on a sighting
 * carrying a state the system recognises: the location used to be guessed from
 * a handful of hardcoded city names, which left every report outside those
 * cities with no jurisdiction and therefore in no officer's queue.
 */

/** States and union territories, alphabetical, as the reporter picks them. */
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

/** True for a value the jurisdiction rules will recognise. */
export function isIndianState(value) {
  const target = String(value || '').trim().toLowerCase();
  return INDIAN_STATES.some((state) => state.toLowerCase() === target);
}
