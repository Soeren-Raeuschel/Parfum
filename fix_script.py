import re

with open('/Users/sorenrauschel/Desktop/Parfum/src/App.js', 'r') as f:
    content = f.read()

# Fix 1: Replace allBlocked check (lines 1306-1310)
old = '''const allBlocked = pool.every(m => _gtmState[m.id].blockedUntil > Date.now());
        if (allBlocked) {
          const earliest = pool.reduce((min, m) => Math.min(min, _gtmState[m.id].blockedUntil), Infinity);
          _groqRetryAfterUntil = earliest;
        }'''

new = '''const allBlocked = pool.every(m => {
          const s = _gtmState[m.id];
          return s && typeof s === 'object' && s != null && s.blockedUntil > Date.now();
        });
        if (allBlocked) {
          const earliest = pool.reduce((min, m) => {
            const s = _gtmState[m.id];
            return s && typeof s === 'object' && s != null ? Math.min(min, s.blockedUntil) : min;
          }, Infinity);
          _groqRetryAfterUntil = earliest;
        }'''

if old in content:
    content = content.replace(old, new)
    print('Fix 1 applied')
else:
    print('Fix 1 pattern not found')
    # Show actual lines
    lines = content.split('\n')
    for i, line in enumerate(lines[1305:1311], 1306):
        print(f'{i}: {repr(line)}')

with open('/Users/sorenrauschel/Desktop/Parfum/src/App.js', 'w') as f:
    f.write(content)
