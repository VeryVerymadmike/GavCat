#!/bin/sh
# index.html = cat-stretch.html wrapped for GitHub Pages
cd "$(dirname "$0")" && { printf '<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'; cat cat-stretch.html; printf '\n</html>\n'; } > index.html
