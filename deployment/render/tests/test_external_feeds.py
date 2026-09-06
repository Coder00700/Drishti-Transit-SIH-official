import os
import unittest
from unittest.mock import patch

from deployment.render import external_feeds as feeds


class ExternalFeedFailoverTests(unittest.TestCase):
    def test_weather_moves_to_met_norway(self):
        met = {'properties': {'timeseries': [{'time': '2026-09-06T10:00:00Z', 'data': {
            'instant': {'details': {'air_temperature': 31, 'relative_humidity': 61, 'wind_speed': 2}},
            'next_1_hours': {'details': {'precipitation_amount': 0.2, 'probability_of_precipitation': 20}},
        }}]}}
        with patch.object(feeds, '_provider_json', side_effect=[RuntimeError('primary down'), met]) as call:
            result = feeds.weather()
        self.assertEqual(result['provider'], 'MET Norway')
        self.assertTrue(result['fallback'])
        self.assertEqual(call.call_count, 2)

    def test_traffic_moves_from_tomtom_to_here(self):
        here = {'results': [{'type': 'Feature', 'geometry': None, 'properties': {}}]}
        with patch.dict(os.environ, {'TOMTOM_TRAFFIC_API_KEY': 'one', 'HERE_TRAFFIC_API_KEY': 'two'}), \
             patch.object(feeds, '_provider_json', side_effect=[RuntimeError('primary down'), here]):
            result = feeds.traffic()
        self.assertEqual(result['provider'], 'HERE Traffic')
        self.assertTrue(result['fallback'])
        self.assertEqual(len(result['features']), 1)

    def test_traffic_has_truthful_no_key_fallback(self):
        with patch.dict(os.environ, {}, clear=True):
            result = feeds.traffic()
        self.assertFalse(result['live'])
        self.assertFalse(result['configured'])
        self.assertIn('delhipolice.gov.in', result['advisory_url'])

    def test_provider_failure_enters_short_cooldown(self):
        feeds._COOLDOWNS.clear()
        with patch.object(feeds, '_json', side_effect=OSError('timeout')):
            with self.assertRaises(OSError):
                feeds._provider_json('test-provider', 'https://example.invalid', 1, ('test',))
        self.assertIn('test-provider', feeds._COOLDOWNS)


if __name__ == '__main__':
    unittest.main()
