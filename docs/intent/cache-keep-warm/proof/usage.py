"""Print each API response's token usage in a Claude Code transcript (JSONL): when, and what the cache served or wrote."""
import json
import sys

for path in sys.argv[1:]:
    print(f'== {path.replace(chr(92), "/").split("/")[-2].split("live-")[-1]}')
    print(f'{"time (UTC)":<20} {"input":>7} {"cache read":>11} {"cache write":>12} {"output":>7}')
    seen = set()
    with open(path, encoding='utf-8') as f:
        for line in f:
            row = json.loads(line)
            message = row.get('message') or {}
            usage = message.get('usage')
            if row.get('type') != 'assistant' or not usage or message.get('id') in seen:
                continue
            seen.add(message.get('id'))
            print(f'{row.get("timestamp", "")[:19]:<20} {usage.get("input_tokens", 0):>7} {usage.get("cache_read_input_tokens", 0):>11} {usage.get("cache_creation_input_tokens", 0):>12} {usage.get("output_tokens", 0):>7}')
