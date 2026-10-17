/**
 * Checks that record text is shown in the reader's script.
 *
 * Gujarat Police's register is in Gujarati; an officer reading the console in
 * English saw Gujarati script they could not read. Records keep the original;
 * the console converts at display time (web/src/scriptDisplay.js).
 *
 *   node scripts/script-display-smoke.mjs
 */
import process from 'node:process';

import { displayPlace, displayText } from '../web/src/scriptDisplay.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const is = (name, actual, expected) => check(name, actual === expected, `${JSON.stringify(actual)}${actual === expected ? '' : ` (expected ${JSON.stringify(expected)})`}`);

// Made-up names; the shapes match the police register.
is('a Gujarati name reads in English', displayText('કમલેશ રમણભાઈ પટેલ', 'en'), 'Kamlesh Ramanbhai Patel');
is('a diary reference reads in English', displayText('વટવા પો.સ્ટે. જા.જોગ નં. 254/07', 'en'), 'Vatva P.S. Diary No. 254/07');
is('an FIR reference with Gujarati digits reads in English', displayText('ઓઢવ ફ. ૯૩.૧૬ ઈપીકો ૩૬૩', 'en'), 'Odhav FIR 93.16 IPC 363');
is('station names use their usual English spelling', displayText('સાબરમતી પોલીસ સ્ટેશન', 'en'), 'Sabarmati Police Station');
is('relationship abbreviations read in English', displayText('રીના ડો/ઓ સુરેશભાઈ', 'en'), 'Rina D/o Sureshbhai');
is('Hindi readers get Devanagari', displayText('વટવા પો.સ્ટે.', 'hi'), 'वटवा पो.स्टे.');
is('Marathi readers get Devanagari with Latin digits', displayText('નં. ૨૫૪', 'mr'), 'नं. 254');
is('Gujarati readers get the original', displayText('વટવા પો.સ્ટે.', 'gu'), 'વટવા પો.સ્ટે.');
is('English text is left alone', displayText('Vejalpur Police Station', 'en'), 'Vejalpur Police Station');
is('English text is left alone for Hindi readers too', displayText('Mumbai', 'hi'), 'Mumbai');
is('empty values pass through', displayText('', 'en'), '');
is('missing values pass through', displayText(null, 'en'), null);
is('places read in Gujarati for a Gujarati reader', displayPlace('Ahmedabad', 'gu'), 'અમદાવાદ');
is('places read in Devanagari for a Marathi reader', displayPlace('Gujarat', 'mr'), 'गुजरात');
is('places stay English for an English reader', displayPlace('Ahmedabad', 'en'), 'Ahmedabad');
is('an unknown place is shown as stored', displayPlace('Kutch', 'gu'), 'Kutch');

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) process.exit(1);
console.log('Script display checks passed.');
