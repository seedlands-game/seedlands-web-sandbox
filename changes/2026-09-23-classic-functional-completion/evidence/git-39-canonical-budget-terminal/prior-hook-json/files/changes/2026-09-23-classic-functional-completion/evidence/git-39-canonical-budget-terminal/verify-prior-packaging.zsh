#!/bin/zsh

set -e

root=/private/tmp/seedlands-git39-canonical-budget-terminal
acceptance=/private/tmp/seedlands-v2-acceptance-0eafd427
base=changes/2026-09-23-classic-functional-completion
git39=$base/evidence/git-39-canonical-budget-terminal
prior=$git39/prior-packaging/files
browser=$base/evidence/v2-canonical-browser-23
map=$base/evidence/v2-browser23-canonical-budget-map-01

hash_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

check_hash() {
  expected=$1
  filepath=$2
  actual=$(hash_file "$filepath")
  test "$actual" = "$expected" || {
    printf 'HASH_MISMATCH expected=%s actual=%s path=%s\n' "$expected" "$actual" "$filepath" >&2
    return 1
  }
}

cd "$root"

old_browser=$prior/$browser
while read -r expected relative; do
  relative=${relative#./}
  case "$relative" in
    attachments/test-0-error-context.md) target=$old_browser/attachments/test-0-error-context.md.log ;;
    README.md | SOURCE-MANIFEST.sha256 | playwright-attachments.json) target=$old_browser/$relative ;;
    *) target=$browser/$relative ;;
  esac
  check_hash "$expected" "$target"
done < "$old_browser/MANIFEST.sha256"
check_hash d275044b38e568f82eb054f11356fa1ea12faa5a0bf363b46bb80fdd485b1160 "$old_browser/SOURCE-MANIFEST.sha256"
check_hash f144b09a24ebb6bd0d8e0a11d99407e24f1ccc36f126664cba2679faf55e2316 "$old_browser/MANIFEST.sha256"
check_hash bf8b7aecfb5a5ad348e03445e766212570bfdee0685931ed13a7196102b7b04c "$old_browser/delivery-validation.json"
printf 'PRIOR_BROWSER23_MANIFEST127=PASS\n'

old_map=$prior/$map
while read -r expected relative; do
  relative=${relative#./}
  case "$relative" in
    README.md | diagnosis.json) target=$old_map/$relative ;;
    *) target=$map/$relative ;;
  esac
  check_hash "$expected" "$target"
done < "$old_map/MANIFEST.sha256"
while read -r expected filepath; do
  case "$filepath" in
    $browser/delivery-validation.json) target=$old_browser/delivery-validation.json ;;
    $browser/*) target=$filepath ;;
    *) target=$acceptance/$filepath ;;
  esac
  check_hash "$expected" "$target"
done < "$old_map/SOURCE-MANIFEST.sha256"
check_hash 64ce50ef3284e12a92a410600c1dc6b663330fdf0f3954d91adb50cbfc2fbc68 "$old_map/SOURCE-MANIFEST.sha256"
check_hash 554fb4aabcce039eb93870b695143f8403edb154a3b314fc793d5fbecf4ead55 "$old_map/MANIFEST.sha256"
check_hash 828f23d14b54d51f19d5fd66d6454da8322b2210526d73f80713d412e992da61 "$old_map/delivery-validation.json"
printf 'PRIOR_MAP_SOURCE23_MANIFEST10=PASS\n'

old_git39=$prior/$git39
while read -r expected relative; do
  relative=${relative#./}
  case "$relative" in
    README.md | SOURCE-MANIFEST.sha256 | evidence-staged.paths | evidence-staged.actual.paths | final-selfcheck.zsh)
      target=$old_git39/$relative
      ;;
    *) target=$git39/$relative ;;
  esac
  check_hash "$expected" "$target"
done < "$old_git39/MANIFEST.sha256"
check_hash 9431139f712b23814c0d368fbe49531875264c3f8a7a29fb89ab566537fdd1db "$old_git39/SOURCE-MANIFEST.sha256"
check_hash 5569be8e1ae4dea3562cc0ee17dd492b0631af7b0653ae763b6ea1bd3a400473 "$old_git39/MANIFEST.sha256"
check_hash 7b4fe1caabf2efd197228c788972bd121ae279ce9a8884afe5b90ae48c0c6944 "$old_git39/delivery-validation.json"
printf 'PRIOR_GIT39_MANIFEST20=PASS\n'
printf 'PRIOR_PACKAGING_MAPPING=PASS\n'
