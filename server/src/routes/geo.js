// Express binding for the shared gazetteer routes (state and district lists).
// Handlers live in shared/routes/geo.js so the Cloudflare Worker serves the
// same answers. They read no store and need no dependencies.
import { Router } from 'express';

import registerGeoRoutes from '../../../shared/routes/geo.js';

export default registerGeoRoutes(Router());
