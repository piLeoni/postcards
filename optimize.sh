

# python __init__.py --address "sutro baths, sf" --output test/v.svg
python shuffle_order.py test/v.svg test/vs.svg
python colorize_order.py test/vs.svg test/vc.svg

python optimize.py test/vc.svg test/vopt
python colorize_order.py test/vopt.svg test/voptc.svg
inkscape test/vopt.svg

# vpype read test/vopt.svg stat | grep Pen-up

# vpype read test/test.svg deduplicate --densify -t 1mm write test/out.svg && inkscape test/out.svg
