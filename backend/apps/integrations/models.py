from django.db import models

class WeatherReading(models.Model):
    id = models.BigAutoField(primary_key=True)
    zone_id = models.IntegerField()
    station_id = models.TextField()
    reading_time = models.DateTimeField()
    rainfall_mm = models.FloatField()
    soil_moisture_pct = models.FloatField(null=True, blank=True)
    source = models.TextField()

    class Meta:
        managed = False
        db_table = "weather_readings"
        ordering = ["-reading_time"]
