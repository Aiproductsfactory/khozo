import { Link } from 'react-router-dom';
import { Logo, PublicActions } from '../components.jsx';
import { LanguageSwitcher, useT } from '../i18n.jsx';

/*
 * /child/:id was the shareable page for one missing child. Case pages are no
 * longer public (shared/case-domain.js isPublicAppeal): the public never sees
 * the name or photo of a missing person. The route stays so links already sent
 * over WhatsApp land somewhere that explains why, rather than on a blank page.
 *
 * Deliberately reads nothing: the id in the address is never sent to the
 * server, and nothing about any person is fetched or rendered here.
 */
export default function ChildCase() {
  const t = useT();
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link to="/" className="btn-ghost">{t('Home')}</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="rounded-2xl border border-black/5 bg-white p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-ink">{t('Case pages are not public')}</h1>
          <p className="mt-3 text-gray-600">
            {t('Khozo never shows the name or photo of a missing person to the public, so this link does not open a case.')}
          </p>
          <p className="mt-2 text-gray-600">
            {t('If you have seen someone who seems lost, send a photo — the engines compare it and only authorised officers see who matched.')}
          </p>
        </div>

        <PublicActions className="mt-6" />

        <p className="mt-8 text-sm text-gray-500">
          {t('If a child appears to be in immediate danger, call {childline} or {police} first.', { childline: '1098', police: '112' })}
        </p>
      </main>
    </div>
  );
}
