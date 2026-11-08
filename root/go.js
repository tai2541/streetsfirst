// Send visitors to the Seattle site, keeping any place link (#p=...) or query they came with.
location.replace('seattle/' + location.search + location.hash);
