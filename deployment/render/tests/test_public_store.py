import unittest
import mongomock
from deployment.render.public_store import current_release, overview, roads


class PublicStoreTests(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).DrishtiPublic

    def test_empty_replica_is_safe(self):
        self.assertIsNone(current_release(self.db)[1])
        self.assertEqual([], overview(self.db)['updates'])

    def test_only_current_ready_release_is_returned(self):
        self.db.state.insert_one({'_id': 'current', 'release_id': 'ready'})
        self.db.releases.insert_many([{'_id': 'old', 'state': 'READY'}, {'_id': 'ready', 'state': 'READY'}])
        self.db.content_snapshots.insert_many([
            {'_id': 'old:x', 'release_id': 'old', 'id': 'x', 'title': 'Old', 'status': 'RESOLVED'},
            {'_id': 'ready:y', 'release_id': 'ready', 'id': 'y', 'title': 'Current', 'status': 'IN_PROGRESS'}])
        self.db.road_snapshots.insert_many([
            {'_id': 'old:r', 'release_id': 'old', 'road_id': 'r', 'area_id': 'x',
             'geometry': {'type': 'Point', 'coordinates': [77.1, 28.6]}},
            {'_id': 'ready:s', 'release_id': 'ready', 'road_id': 's', 'area_id': 'y',
             'geometry': {'type': 'Point', 'coordinates': [77.2, 28.7]}, 'severity': 'LOW'}])
        self.assertEqual(['Current'], [row['title'] for row in overview(self.db)['updates']])
        self.assertEqual(['s'], [f['properties']['road_id'] for f in roads(db=self.db)['features']])


if __name__ == '__main__':
    unittest.main()
