trap 'select wtd in bash restart exit; do [ $wtd = restart ] && break || $wtd ; done' \
	2;
while true; do
	     node index.js; 
     done
