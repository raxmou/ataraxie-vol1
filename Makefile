run:
	python3 -m http.server 8000

lint:
	npx eslint js/ --ext .js

format:
	npx prettier --write "js/**/*.js" "css/**/*.css" "*.html"

format-check:
	npx prettier --check "js/**/*.js" "css/**/*.css" "*.html"
