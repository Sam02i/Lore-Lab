  #!/usr/bin/env bash
  # Run from the project root:  bash swap-fonts.sh
  # Moves style.css and sections.css (the two files that weren't shared) onto the new fonts.
  #   Swanky and Moo Moo  -> Caveat Brush   (display / titles)
  #   Delius              -> Patrick Hand   (body)
  #   Delicious Handrawn  -> Patrick Hand   (body)
  # If some big title in those files used Delicious Handrawn, change it to Caveat Brush by hand.
  set -euo pipefail
  cd frontend
  for f in style.css sections.css; do
    [ -f "$f" ] || { echo "skip $f (not found)"; continue; }
    cp "$f" "$f.bak"
    sed -i -e 's/Swanky and Moo Moo/Caveat Brush/g' \
          -e 's/Delicious Handrawn/Patrick Hand/g' \
          -e 's/\bDelius\b/Patrick Hand/g' "$f"
    echo "$f: updated (backup at $f.bak)"
  done
  echo
  echo "Anything still naming an old font (check JS too):"
  grep -rn "Delius\|Swanky\|Delicious" --include=*.css --include=*.js --include=*.html . | grep -v "\.bak" || echo "  none"
  echo
  echo "Last step: delete the TEMPORARY legacy fonts <link> in index.html."
