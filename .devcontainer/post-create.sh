#!/bin/bash
set -e

npm install -g @anthropic-ai/claude-code
npm install
chmod 700 /home/node/.gnupg

# Symlink the host's .claude path into the container so Claude Code plugins
# that store absolute host paths (e.g. known_marketplaces.json) resolve correctly.
sudo mkdir -p /Users/korzun
sudo ln -sfn /home/node/.claude /Users/korzun/.claude
