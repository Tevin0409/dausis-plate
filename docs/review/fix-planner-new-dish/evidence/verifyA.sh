AB="npx agent-browser --session dev-implementor"; F="form:has(input[name=name])"
P="$HOME/.openrig/workspace/specs/dausis-plate-team/bin/dev-stack.sh"
DAY=$(TZ=Africa/Nairobi date +%F)
$AB set viewport 1280 900 >/dev/null
$AB open "http://127.0.0.1:54321/dev/login?to=http://127.0.0.1:3020/dashboard" >/dev/null; $AB wait --load networkidle >/dev/null
$AB open "http://127.0.0.1:3020/dashboard/dishes/new?regular=1" >/dev/null; $AB wait --load networkidle >/dev/null
echo "Dishes > Add a dish, switches: $($AB eval "document.querySelectorAll('$F [role=switch]').length")"
$AB open "http://127.0.0.1:3020/dashboard/dishes/new?day=$DAY" >/dev/null; $AB wait --load networkidle >/dev/null
echo "Planner new dish ($DAY), switches: $($AB eval "document.querySelectorAll('$F [role=switch]').length") text: $($AB eval "document.body.innerText.includes('On the everyday menu')")"
$AB fill 'input[name=name]' 'Repro Stew' >/dev/null; $AB fill 'input[name=price_kes]' '450' >/dev/null
$AB eval "document.querySelector('input[name=add_kind][value=week]').click()" >/dev/null
$AB eval "(()=>{const i=document.querySelector('input[name=show_from]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'12:00');i.dispatchEvent(new Event('input',{bubbles:true}))})()" >/dev/null
$AB screenshot /tmp/dip/A-planner-form-1280.png >/dev/null
$AB eval "document.querySelector('$F button[type=submit]').click()" >/dev/null; sleep 5
echo "after save: $($AB eval "location.pathname+location.search")"
$AB screenshot /tmp/dip/A-after-save-1280.png >/dev/null
cat > /tmp/dip/q.sql <<SQL
select d.is_regular, e.kind, e.starts_on, e.ends_on, e.plates_per_day, e.show_from from dishes d left join menu_entries e on e.dish_id=d.id where d.name='Repro Stew';
SQL
"$P" psql -f /tmp/dip/q.sql 2>&1 | tail -4
$AB set viewport 375 812 >/dev/null
$AB open "http://127.0.0.1:3020/dashboard/dishes/new?day=$DAY" >/dev/null; $AB wait --load networkidle >/dev/null
$AB eval "document.querySelector('section[aria-label=\"Where it\'s sold\"]').scrollIntoView()" >/dev/null
$AB screenshot /tmp/dip/A-planner-form-375.png >/dev/null
echo "375 width: $($AB eval "document.documentElement.scrollWidth")"
"$P" psql -f /tmp/dip/clean.sql 2>&1 | tail -3
