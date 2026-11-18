SELECT 'dir' t, id, site, tenant, email FROM dir_contacts WHERE email LIKE '%berytrade.com''%';
SELECT 'pm' t, site, brand, emails FROM pm_tenants WHERE emails LIKE '%berytrade.com''%';
SELECT 'memo' t, id, memo_id, site, brand, emails FROM memo_targets WHERE emails LIKE '%berytrade.com''%';
SELECT 'mk' t, id, site, brand, emails FROM mk_targets WHERE emails LIKE '%berytrade.com''%';
SELECT 'tm' t, k, emails FROM tm_recipients WHERE emails LIKE '%''%';
SELECT 'dirq' t, COUNT(*) n FROM dir_contacts WHERE email LIKE '%''%' OR email LIKE '%"%' OR email LIKE '% %';
SELECT 'cl' t, COUNT(*) n FROM cl_workers WHERE tenant_email LIKE '%''%';
SELECT 'sent' t, COUNT(*) n, MIN(created_at) a, MAX(created_at) b FROM ms_queue WHERE status='sent' AND created_at >= '2026-11-13T05:00' AND created_at < '2026-11-13T11:00';