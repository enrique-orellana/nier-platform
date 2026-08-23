import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest


HOOK = Path(__file__).parents[1] / ".githooks" / "commit-msg"


def bash_executable() -> str:
    for program_files in filter(None, [os.environ.get("ProgramW6432"), os.environ.get("ProgramFiles")]):
        git_bash = Path(program_files) / "Git" / "bin" / "bash.exe"
        if git_bash.exists():
            return str(git_bash)

    bash = shutil.which("bash")
    if bash and not bash.lower().endswith("system32\\bash.exe"):
        return bash

    pytest.skip("Git Bash is required to execute the commit-msg hook")


@pytest.mark.parametrize(
    "subject",
    [
        "feat: add conventional commit hook",
        "fix(parser): reject malformed subjects",
        "refactor!: simplify commit validation",
        "chore(hooks)!: update developer tooling",
    ],
)
def test_accepts_conventional_commit_subjects(subject):
    with tempfile.TemporaryDirectory() as temp_dir:
        message_file = Path(temp_dir) / "COMMIT_EDITMSG"
        message_file.write_text(subject + "\n", encoding="utf-8")

        result = subprocess.run(
            [bash_executable(), str(HOOK), str(message_file)],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "subject",
    [
        "Add a conventional commit hook",
        "feat add a conventional commit hook",
        "feat:",
        "feat(scope))!: malformed scope",
        "Feat: type must be lowercase",
    ],
)
def test_rejects_non_conventional_commit_subjects(subject):
    with tempfile.TemporaryDirectory() as temp_dir:
        message_file = Path(temp_dir) / "COMMIT_EDITMSG"
        message_file.write_text(subject + "\n", encoding="utf-8")

        result = subprocess.run(
            [bash_executable(), str(HOOK), str(message_file)],
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        assert "Conventional Commit" in result.stderr
