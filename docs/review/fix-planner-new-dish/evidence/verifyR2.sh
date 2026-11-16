# Round 2 (RQAPN-01): a refusal, then Reload or Back, then Save must give 1 dish and 1 entry.
# Local stack, app on 3020. The refusal is made real by closing today's weekday after the page loads.
AB="npx agent-browser --session dev-implementor"; F="form:has(input[name=name])"
P="$HOME/.openrig/workspace/specs/dausis-plate-team/bin/dev-stack.sh"
DAY=$(TZ=Africa/Nairobi date +%F); W=$(TZ=Africa/Nairobi date +%w)
URL="http://127.0.0.1:3020/dashboard/dishes/new?day=$DAY"
q() { printf "%s\n" "$1" > /tmp/dip/q.sql; "$P" psql -tA -f /tmp/dip/q.sql 2>&1 | tail -1; }
count() { echo "dishes=$(q "select count(*) from dishes where name='Repro Stew';") entries=$(q "select count(*) from menu_entries e join dishes d on d.id=e.dish_id where d.name='Repro Stew';")"; }
fill() {
  $AB fill 'input[name=name]' 'Repro Stew' >/dev/null; $AB fill 'input[name=price_kes]' '450' >/dev/null
  $AB eval "document.querySelector('input[name=add_kind][value=day]').click()" >/dev/null
}
newid() { $AB eval "document.querySelector('$F input[name=new_id]').value"; }
save() { $AB eval "document.querySelector('$F button[type=submit]').click()" >/dev/null; sleep 4; }
clean() { "$P" psql -f /tmp/dip/clean.sql >/dev/null 2>&1; q "update opening_hours set is_open=true where weekday=$W;" >/dev/null; }

clean
$AB set viewport 375 812 >/dev/null
$AB open "http://127.0.0.1:54321/dev/login?to=http://127.0.0.1:3020/dashboard" >/dev/null; $AB wait --load networkidle >/dev/null

for path in reload back; do
  echo "== $path"
  $AB open "http://127.0.0.1:3020/dashboard/menu?day=$DAY" >/dev/null; $AB wait --load networkidle >/dev/null
  $AB open "$URL" >/dev/null; $AB wait --load networkidle >/dev/null
  fill; echo "new_id before: $(newid)"
  q "update opening_hours set is_open=false where weekday=$W;" >/dev/null
  save
  echo "refusal: $($AB eval "document.querySelector('[role=status]')?.innerText ?? ''" | tr '\n' ' ')"
  echo "after refusal: $(count)"
  [ $path = reload ] && $AB screenshot /tmp/dip/R2-refusal-375.png >/dev/null
  q "update opening_hours set is_open=true where weekday=$W;" >/dev/null
  if [ $path = reload ]; then $AB reload >/dev/null; else $AB back >/dev/null; $AB wait --load networkidle >/dev/null; $AB forward >/dev/null; fi
  $AB wait --load networkidle >/dev/null
  echo "at: $($AB eval "location.pathname+location.search") new_id now: $(newid)"
  fill; save
  echo "after save: $($AB eval "location.pathname+location.search") $(count)"
  clean
done
echo "left: $(count) open=$(q "select is_open from opening_hours where weekday=$W;")"
