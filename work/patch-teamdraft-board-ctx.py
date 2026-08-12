#!/usr/bin/env python3
"""Stage TOTO-PAGES follow-up, part two — teamdraft hands over its board.

Un-skipping buttons put the pick cells within reach of the reader, but "within reach"
is not "in the prompt": the board is 32 cells on a page with ten sections, and the
round-robin budget gives it a handful of lines. Asked who got the biggest steal, Toto
would still be reading four picks out of twenty-five.

Curated beats scraped, and this page knows which part of itself the question is about.
So its ctx() now builds the board itself — every made pick, its expected wins, what
the best team still on the board was, and the gap — compacted from the same data-tip
the page already renders, and the general reader runs underneath on what is left.
"""
import sys

F = "teamdraft.html"

OLD = """  ctx: () => `THE 32-TEAM DRAFT PAGE."""
NEW = """  /* The board is the answer to the most obvious question this page invites — who
     reached, who stole — and it is 32 cells deep, which is more than the shared
     reader's round-robin will ever hand over. So take it directly. The data-tip is
     already rendered on every cell; this is the same numbers, compacted. */
  board(){
    const cells = document.querySelectorAll('#tdBoard .td-bc');
    if(!cells.length) return 'The board has not rendered yet.';
    const L = ['THE BOARD, PICK BY PICK. "Gap" is expected wins given up against the best team still on the board at that moment — a description of draft day computed against the numbers as they stood then, NOT a grade of the pick and never recomputed against live ratings:'];
    for(let i = 0; i < cells.length; i++){
      const c = cells[i];
      /* ⚠️ Keep the line breaks as a delimiter. Flattening them to spaces makes the
         drafter's name unparseable the moment a team name starts with a digit — "Pick
         12 · Tyler 49ers — 10.02 expected wins…" ran the name on to the next capital
         letter and put half the tip in the drafter field. */
      const tip = (c.getAttribute('data-tip') || '').replace(/<br\\s*\\/?>/gi, '|')
        .replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/\\s+/g, ' ').trim();
      if(!tip){ continue; }                       // an empty slot — still on the clock
      const pick = /Pick (\\d+) . ([^|]+)/.exec(tip), ew = /— ([\\d.]+) expected wins/.exec(tip);
      const best = /best available was (\\S+) at ([\\d.]+)/.exec(tip);
      const rank = /was #(\\d+) of (\\d+)/.exec(tip);
      const code = c.querySelector('.t'), d = c.querySelector('.d');
      const delta = d ? d.textContent.replace(/\\s+/g, ' ').trim() : '';
      L.push('P' + (pick ? pick[1] : '?') + ' ' + (pick ? pick[2].trim() : '?')
        + ' · ' + (code ? code.textContent.trim() : '?') + ' ' + (ew ? ew[1] : '?') + ' EW'
        + (best ? ' · best available ' + best[1] + ' ' + best[2] : '')
        + (rank ? ' · #' + rank[1] + ' of ' + rank[2] + ' left' : '')
        + ' · gap ' + (delta === 'best available' ? '0 (took the best available)' : delta));
    }
    const onClock = cells.length - (L.length - 1);
    if(onClock > 0) L.push(onClock + ' slot' + (onClock > 1 ? 's are' : ' is') + ' still on the clock — the draft is not finished, so every roster figure is a partial roster.');
    return L.join('\\n');
  },
  ctx(){ return this.spine() + '\\n\\n' + this.board() + '\\n\\n'
    + (window.DDBotScan ? window.DDBotScan(4200) : 'The page reader could not run.'); },
  spine: () => `THE 32-TEAM DRAFT PAGE."""

OLD_TAIL = """` + (window.DDBotScan ? window.DDBotScan(5200) : "The page reader could not run, so nothing on the page can be read right now.")
};
</script>
</body>"""
NEW_TAIL = """`
};
</script>
</body>"""


def main():
    s = open(F, encoding="utf-8").read()
    for name, old, new in [("ctx head", OLD, NEW), ("ctx tail", OLD_TAIL, NEW_TAIL)]:
        assert s.count(old) == 1, f"{F}: {name} matched {s.count(old)} times"
        s = s.replace(old, new)
    open(F, "w", encoding="utf-8").write(s)
    print("patched", F)


if __name__ == "__main__":
    main()
