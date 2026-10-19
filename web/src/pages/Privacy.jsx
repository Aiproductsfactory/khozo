import { Link } from 'react-router-dom';
import { currentLocale, msg, useT } from '../i18n.jsx';
import { PublicFooter, PublicHeader, usePageMeta } from '../PublicChrome.jsx';

/*
 * The public privacy policy: what Khozo collects, why, who sees it, how long
 * it is kept, and people's rights, in plain words. The longer draft written for
 * legal review is docs/governance/privacy-notice.md; keep the two in step.
 *
 * Khozo is named as responsible for now. When a police department signs an
 * agreement for its area, it takes that place, and this page says so.
 */

// The Grievance Officer, once one is named: { name, role, email, phone }.
// Until then the page sends people to the complaints form, which reaches the
// desks that handle data-privacy complaints.
const GRIEVANCE_OFFICER = null;

const LAST_UPDATED = '2026-10-19';

const SECTIONS = [
  {
    id: 'never',
    title: msg('What the public never sees'),
    items: [
      msg('The name or photo of any missing person. There is no public gallery and no public search.'),
      msg('Whether a photo you sent matched anyone.'),
      msg('Where a traced woman or adult is.'),
      msg('Who sent a report.'),
    ],
  },
  {
    id: 'sighting',
    title: msg('When you send a sighting'),
    lead: msg('No account or login is needed. We use what you send to compare the face with missing persons, send the report to the right office, and call you only if an officer needs more detail.'),
    items: [
      msg('The photo, if you add one. Its location data and phone details are removed before it is stored.'),
      msg('The place: from the photo, from your phone’s location, or what you type.'),
      msg('Who you saw (a child, a woman or another person), their rough age and gender, and a note.'),
      msg('For a woman or an adult, what made you think they need help.'),
      msg('If you opened the form from a poster’s code, which poster it was.'),
      msg('Only if you choose: your name and phone, and the type of a photo ID with only its last 4 digits. You can ask that officers do not see your name and phone.'),
    ],
  },
  {
    id: 'register',
    title: msg('When you register a missing person'),
    lead: msg('Parents, NGOs and the police register missing persons, so that the police can search for them and contact the family.'),
    items: [
      msg('The person’s name, photo, age, description and the date they went missing, and the family’s contact details.'),
      msg('Aadhaar is optional. We keep only its last 4 digits, and a scrambled form used to spot the same case registered twice.'),
      msg('A case from a parent or an NGO is checked by an officer before it is compared with any sighting.'),
    ],
  },
  {
    id: 'accounts',
    title: msg('Accounts, complaints and visits'),
    items: [
      msg('An account holds your name, email, phone, a scrambled form of your password, and your role and office.'),
      msg('Every action an officer takes in Khozo is recorded under that officer’s name.'),
      msg('A complaint holds your name (if you give it), phone, email, district and what happened, so that we can answer it.'),
      msg('When you visit, your internet address is held for a short time to stop misuse. When it is switched on, Cloudflare also checks that a person, not a computer program, is sending a report.'),
    ],
  },
  {
    id: 'matching',
    title: msg('How face matching works'),
    items: [
      msg('Aarakshak, an Indian face-recognition service, compares a sighting photo with the photos of open cases, and a new case photo with recent sightings. During the trial, Amazon Web Services (Mumbai region) gives a second check.'),
      msg('A match is only a suggestion. An officer checks the person face to face before anything is decided, and before any family is told.'),
      msg('Khozo is used only to find missing persons: never for advertising, selling data, watching people or training computer models.'),
    ],
  },
  {
    id: 'children',
    title: msg('Children'),
    items: [
      msg('A missing child is protected by the Juvenile Justice Act, 2015. No one may publish anything that identifies the child without the Child Welfare Committee’s written permission. Khozo never publishes.'),
      msg('A child who is found is taken to the Child Welfare Committee, or to Childline 1098.'),
    ],
  },
  {
    id: 'adults',
    title: msg('Women and adults'),
    items: [
      msg('An adult has the right not to be found. If you are traced, an officer speaks to you first, and your family is told where you are only if you agree.'),
      msg('A relative who registered you sees only what they entered, never where you were found.'),
    ],
  },
  {
    id: 'processors',
    title: msg('Who handles your information for us'),
    items: [
      msg('Cloudflare runs the website and its servers.'),
      msg('Supabase hosts the database that holds records and photos.'),
      msg('Aarakshak compares faces; during the trial, Amazon Web Services gives a second check.'),
      msg('OpenStreetMap turns a map position into a district.'),
      msg('Google Fonts supplies the Gujarati, Hindi and Marathi letters, so your browser contacts Google when a page opens.'),
      msg('Once connected, an SMS service will send sign-up codes.'),
      msg('Some of these services may handle information outside India.'),
    ],
  },
  {
    id: 'keeping',
    title: msg('How long we keep it'),
    items: [
      msg('A sighting and its photo: 180 days, or longer only if a case needs it. If an officer finds that the photo shows someone who is not missing and not in need, it is deleted at once.'),
      msg('A missing-person case and its photo: 10 years from registration.'),
      msg('The record of officers’ actions: kept for good, and it cannot be changed. It does not name members of the public.'),
      msg('Accounts and complaints: while they are needed.'),
      msg('A report waiting on your phone for a signal: up to 72 hours, locked so that only Khozo can read it.'),
      msg('Today, records whose time is up are reviewed and removed each month. Automatic deletion is being switched on.'),
    ],
  },
  {
    id: 'rights',
    title: msg('Your rights'),
    items: [
      msg('You can ask to see the information about you, correct it, or delete it (the police may have to keep some records for an investigation). You can withdraw your agreement to a sighting photo, name someone to act for you, and complain.'),
      msg('To make a request or a complaint, use the complaints form on this site and choose “Data privacy”. Give your receipt or case number if you have one. We reply within 30 days.'),
      msg('If you are not satisfied with our answer, you may complain to the Data Protection Board of India.'),
    ],
  },
];

export default function Privacy() {
  const t = useT();
  usePageMeta({
    title: msg('Privacy policy'),
    description: msg('What Khozo collects when you report a sighting or register a missing person, who sees it, how long it is kept, and your rights.'),
  });
  const updated = new Date(`${LAST_UPDATED}T00:00:00`).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-[#f6f8f5]">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">{t('Privacy policy')}</h1>
        <p className="mt-3 text-lg text-gray-700">
          {t('This page explains what Khozo collects, why, who sees it, how long it is kept, and your rights. Khozo is responsible for how your information is used.')}
        </p>
        <p className="mt-2 text-sm text-gray-500">
          {t('When a police department agrees to use Khozo for its area, that department becomes responsible for the information from its area, and this page will say so.')}
        </p>

        <div className="mt-8 space-y-6">
          {SECTIONS.map((section) => (
            <section key={section.id} aria-labelledby={`privacy-${section.id}`} className="card p-5 sm:p-7">
              <h2 id={`privacy-${section.id}`} className="text-xl font-bold text-ink">{t(section.title)}</h2>
              {section.lead && <p className="mt-2 text-gray-700">{t(section.lead)}</p>}
              <ul className="mt-3 list-disc space-y-2 pl-5 text-gray-700 marker:text-khozo">
                {section.items.map((item) => <li key={item}>{t(item)}</li>)}
              </ul>
              {section.id === 'rights' && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link to="/grievance" className="btn-primary">{t('Open the complaints form')}</Link>
                  {GRIEVANCE_OFFICER && (
                    <p className="text-sm text-gray-700">
                      {t('Grievance Officer: {name}, {role}', { name: GRIEVANCE_OFFICER.name, role: GRIEVANCE_OFFICER.role })}
                      {' · '}{GRIEVANCE_OFFICER.email}{GRIEVANCE_OFFICER.phone ? ` · ${GRIEVANCE_OFFICER.phone}` : ''}
                    </p>
                  )}
                </div>
              )}
            </section>
          ))}

          <section aria-labelledby="privacy-emergency" className="rounded-2xl bg-red-50/70 p-5 ring-1 ring-red-100 sm:p-7">
            <h2 id="privacy-emergency" className="text-xl font-bold text-red-900">{t('In an emergency')}</h2>
            <p className="mt-2 text-red-900">
              {t('A child in danger: call 1098 or 112. A woman in danger: call 112 or the Women Helpline 181. Anyone else: call 112.')}
            </p>
          </section>
        </div>

        <p className="mt-8 text-sm text-gray-500">
          {t('When we change this policy, we change this date. Last updated: {date}.', { date: updated })}
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}
