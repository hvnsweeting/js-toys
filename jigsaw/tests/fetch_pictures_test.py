"""Check that a failed picture refresh leaves the published set complete."""

import shutil
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import fetch_pictures


class PictureRefreshTest(unittest.TestCase):
    def setUp(self) -> None:
        scratch = Path(__file__).resolve().parents[1] / ".scratch"
        scratch.mkdir(exist_ok=True)
        self.fixture = Path(tempfile.mkdtemp(prefix="picture-test-", dir=str(scratch)))
        self.pictures = self.fixture / "pictures"

    def tearDown(self) -> None:
        shutil.rmtree(self.fixture)

    def build(self, stage: Path) -> None:
        (stage / "new.jpg").write_bytes(b"complete")
        (stage / "manifest.json").write_text("[]\n")
        (stage / "CREDITS.md").write_text("# Credits\n")

    def old(self) -> None:
        self.pictures.mkdir()
        (self.pictures / "old.jpg").write_bytes(b"old")

    def refresh(self) -> None:
        with patch.object(fetch_pictures, "build_picture_set", self.build):
            fetch_pictures.refresh_picture_set(self.pictures, self.fixture)

    def test_failure_preserves_old_set_and_success_replaces_it(self) -> None:
        self.old()

        def fail(stage: Path) -> None:
            (stage / "new.jpg").write_bytes(b"partial")
            raise RuntimeError("download failed")

        with patch.object(fetch_pictures, "build_picture_set", fail):
            with self.assertRaisesRegex(RuntimeError, "download failed"):
                fetch_pictures.refresh_picture_set(self.pictures, self.fixture)
        self.assertEqual((self.pictures / "old.jpg").read_bytes(), b"old")
        self.assertFalse((self.pictures / "new.jpg").exists())
        self.refresh()
        self.assertFalse((self.pictures / "old.jpg").exists())
        self.assertEqual((self.pictures / "new.jpg").read_bytes(), b"complete")

    def test_first_run_publishes_without_a_previous_directory(self) -> None:
        self.refresh()
        self.assertEqual((self.pictures / "new.jpg").read_bytes(), b"complete")
        self.assertFalse((self.fixture / "pictures-previous").exists())

    def test_failure_at_old_directory_rename_preserves_it(self) -> None:
        self.old()
        original = os.replace
        def fail(source: Path, destination: Path) -> None:
            if source == self.pictures:
                raise OSError("first rename failed")
            original(source, destination)
        with patch.object(fetch_pictures.os, "replace", fail):
            with self.assertRaisesRegex(OSError, "first rename failed"):
                self.refresh()
        self.assertEqual((self.pictures / "old.jpg").read_bytes(), b"old")

    def test_failure_at_staged_directory_rename_restores_old(self) -> None:
        self.old()
        original = os.replace
        def fail(source: Path, destination: Path) -> None:
            if source.name.startswith("pictures-stage-"):
                raise OSError("second rename failed")
            original(source, destination)
        with patch.object(fetch_pictures.os, "replace", fail):
            with self.assertRaisesRegex(OSError, "second rename failed"):
                self.refresh()
        self.assertEqual((self.pictures / "old.jpg").read_bytes(), b"old")
        self.assertFalse((self.fixture / "pictures-previous").exists())

    def test_next_run_recovers_missing_directory(self) -> None:
        self.old()
        os.replace(self.pictures, self.fixture / "pictures-previous")
        self.refresh()
        self.assertEqual((self.pictures / "new.jpg").read_bytes(), b"complete")
        self.assertFalse((self.fixture / "pictures-previous").exists())

    def test_cleanup_failure_keeps_new_directory_and_next_run_recovers(self) -> None:
        self.old()
        original = shutil.rmtree
        def fail(path: Path, *args: object, **kwargs: object) -> None:
            if path == self.fixture / "pictures-previous":
                raise OSError("cleanup failed")
            original(path, *args, **kwargs)
        with patch.object(fetch_pictures.shutil, "rmtree", fail):
            with self.assertRaisesRegex(OSError, "cleanup failed"):
                self.refresh()
        self.assertEqual((self.pictures / "new.jpg").read_bytes(), b"complete")
        self.refresh()
        self.assertFalse((self.fixture / "pictures-previous").exists())


if __name__ == "__main__":
    unittest.main()
