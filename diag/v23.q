abc-restroom-db | SELECT flagship,COUNT(*) n,MAX(log_date) d, MIN(log_date) d0 FROM inspection_logs GROUP BY 1
