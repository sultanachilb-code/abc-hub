abc-incidents | SELECT category,status,severity,COUNT(*) FROM incidents GROUP BY 1,2,3
