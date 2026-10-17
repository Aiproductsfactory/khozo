/**
 * The gazetteer, for the state and district pickers (shared/geo).
 *
 *   GET /api/geo/states
 *     { states: [{ code, iso, type, name, names: { en, gu, hi, mr } }], source }
 *   GET /api/geo/districts?state=24
 *     { state: { code, iso, type, name, names }, districts: [{ code, name,
 *       names: { en, gu, hi, mr }, kind? }], source }
 *     `state` is an LGD state code as /states lists it; a name or ISO code in
 *     any of the four languages is accepted too. 400 without one, 404 for a
 *     state the gazetteer does not know.
 *
 * Public, read-only, and the same for everyone, so the answers are cacheable
 * for a day by the browser and any shared cache: the lists change only when
 * the Local Government Directory does, with a new deployment. No account, no
 * store and no personal data are read, which is also why the Worker serves
 * these without loading the case store (worker/index.js).
 *
 * Registered by both runtimes, like the other shared routes.
 */

import { GAZETTEER_SOURCES, listDistricts, listStates, resolveState } from '../geo/index.js';

const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

export default function registerGeoRoutes(router) {
  router.get('/states', (_req, res) => {
    res.set('Cache-Control', CACHE_CONTROL);
    res.json({ states: listStates(), source: GAZETTEER_SOURCES.states });
  });

  router.get('/districts', (req, res) => {
    const asked = typeof req.query?.state === 'string' ? req.query.state.trim().slice(0, 80) : '';
    if (!asked) {
      return res.status(400).json({
        error: 'Name the state, for example /api/geo/districts?state=24 (LGD state codes are listed by /api/geo/states)',
        options: '/api/geo/states',
      });
    }
    const state = resolveState(asked);
    if (!state) {
      return res.status(404).json({ error: `No state or union territory "${asked}"`, options: '/api/geo/states' });
    }
    const named = listStates().find((row) => row.code === state.code);
    res.set('Cache-Control', CACHE_CONTROL);
    res.json({
      state: named,
      districts: listDistricts(state.code),
      source: { lgd: GAZETTEER_SOURCES.lgd, wikidata: GAZETTEER_SOURCES.wikidata },
    });
  });

  return router;
}
