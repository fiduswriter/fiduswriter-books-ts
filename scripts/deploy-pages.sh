#!/usr/bin/env bash
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

echo "Building @fiduswriter/books..."
npm run build

echo "Preparing pages build..."
BUILD_DIR="$ROOT/.pages-build"
rm -rf "$BUILD_DIR"
mkdir "$BUILD_DIR"

cp -r "$ROOT/demo/"* "$BUILD_DIR/"
cp -r "$ROOT/dist" "$BUILD_DIR/"
cp "$ROOT/logo.svg" "$BUILD_DIR/" 2>/dev/null || true

cd "$BUILD_DIR"
git init
git checkout -b pages
git add .
git commit -m "Deploy @fiduswriter/books to Forgejo Pages"

REMOTE=$(cd "$ROOT" && git remote get-url origin)
echo "Pushing to $REMOTE pages branch..."
git remote add origin "$REMOTE"
git push -f origin pages

cd "$ROOT"
rm -rf "$BUILD_DIR"
echo "Done. Available at https://fiduswriter.pages.fiduswriter.org/fiduswriter-books-ts/"
