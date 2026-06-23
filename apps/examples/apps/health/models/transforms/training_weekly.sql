-- Weekly training minutes by sport for the stacked training bar chart.
SELECT date_trunc('week', date)::DATE AS week, sport, sum(duration_min) AS minutes
FROM read_csv_auto('data/workouts.csv')
GROUP BY 1, 2
ORDER BY 1
