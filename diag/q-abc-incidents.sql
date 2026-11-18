SELECT COUNT(*) AS n FROM (SELECT ref, incident_date, flagship, category, type, severity, status, incident_owner, follow_up_date, reported_by_name
FROM incidents WHERE status <> 'Closed' ORDER BY incident_date DESC);
SELECT COUNT(*) AS n FROM (SELECT ref, incident_date, incident_time, flagship, category, type, severity, status, person_type, reported_by_name
FROM incidents WHERE incident_date >= date(date('now','+2 hours'), '-29 days') ORDER BY incident_date DESC, incident_time DESC);
SELECT COUNT(*) AS n FROM (SELECT flagship, category, severity, COUNT(*) AS incidents, SUM(status = 'Closed') AS closed
FROM incidents WHERE substr(incident_date, 1, 4) = strftime('%Y', 'now') GROUP BY 1, 2, 3 ORDER BY 1, incidents DESC);
SELECT COUNT(*) AS n FROM (SELECT substr(incident_date, 1, 7) AS month, flagship, COUNT(*) AS incidents FROM incidents GROUP BY 1, 2 ORDER BY 1 DESC, 2);
SELECT COUNT(*) AS n FROM (SELECT ref, follow_up_date, flagship, type, severity, status, incident_owner
FROM incidents WHERE status <> 'Closed' AND follow_up_date <> '' AND follow_up_date <= date('now','+2 hours') ORDER BY follow_up_date);
SELECT COUNT(*) AS n FROM (SELECT ref, incident_date, flagship, type, severity, status, escalation_triggers, escalated_at, breach_alert_sent_at
FROM incidents WHERE COALESCE(escalation_breach, '') NOT IN ('', '0', 0) ORDER BY incident_date DESC);
SELECT COUNT(*) AS n FROM (SELECT i.ref, i.incident_date, i.flagship, i.type, i.severity, i.status, i.incident_owner
FROM incidents i LEFT JOIN post_incident_reports p ON p.ref = i.ref
WHERE (i.severity LIKE 'Major%' OR i.severity LIKE 'Critical%') AND p.ref IS NULL ORDER BY i.incident_date DESC);
SELECT COUNT(*) AS n FROM (SELECT date_added, flagship, name, person_type, reason, access_status, date_from, date_to, cctv_notified_at
FROM blacklist WHERE COALESCE(date_to, '') = '' OR date_to >= date('now','+2 hours') ORDER BY date_added DESC);
SELECT COUNT(*) AS n FROM (SELECT full_name, email, role, position, flagship_scope, active, created_at FROM users ORDER BY active DESC, role, full_name);
SELECT COUNT(*) AS n FROM (SELECT at, actor_name, action, target_ref, details FROM audit_log WHERE at >= datetime('now', '-7 days') ORDER BY at DESC);