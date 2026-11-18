hub-db | SELECT kind,status,COUNT(*) n FROM portal_items WHERE active=1 GROUP BY 1,2
