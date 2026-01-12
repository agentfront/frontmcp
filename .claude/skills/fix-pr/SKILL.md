---
name: fix-pr
description: Review a CodeRabbit PR comment and produce an action plan when prompted to analyze a review comment.
user-invocable: true
---

When asked to review a single CodeRabbit pull request comment, check whether it’s still valid, then plan fixes and test suggestions.
Fixes must include the nitpicks and outside diffs.

Expected input from the user:

- A single CodeRabbit review comment.

Output should include:

1. Validity (valid / no longer applies)
2. Clear reasoning
3. A fix plan with exact changes
4. Test commands to verify

Example:
User will provide:
