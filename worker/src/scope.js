// Jurisdiction scoping lives in shared/scope.js so the Express and Cloudflare
// Worker builds enforce byte-identical access rules. Re-exported here because
// every route and helper in this package imports it by this path.
export {
  scopeReports,
  canAccessReport,
  scopeFoundReports,
  scopeAudit,
  scopeActivity,
  scopeLabel,
} from '../../shared/scope.js';
