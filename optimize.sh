
# vpype read ./test/vs.svg \
#     linesort -t \
#     trim --layer 1 30mm 30mm \
#     linesimplify -l 1 -t 0.1mm \
#     linemerge --layer 2 -t 0.5mm \
#     filter --layer 2 --min-length 1mm \
#     text -p 10mm 10mm -w 30mm -a right "hello world, how are you doing today? I'm very happy you are writing to me!!!" \
#     write -r  ./test/v_opt2.svg

# inkscape test/vs.svg --export-id="buildings" --export-type=svg --export-filename=test/layer.svg
#     # linemerge --tolerance 0.5mm --layer 2 \
# python colorize_order.py test/v_opt2.svg test/out.svg
# inkscape test/out.svg 


# inkscape test/v.svg --export-id="buildings" --export-type=svg --export-area-page --export-filename="test/layer-buildings.svg"
# inkscape test/v.svg --export-id="details" --export-type=svg --export-area-page --export-filename="test/layer-details.svg"

# vpype \
#   read --layer 1 test/layer-buildings.svg color "#1f77b4" \
#   read --layer 2 test/layer-details.svg color "#ff7f0e" \
#   write test/layer-combined.svg
  
# inkscape test/layer-details.svg

python __init__.py --address "colosseum, rome" --output test/v.svg
python shuffle_order.py test/v.svg test/vs.svg
python colorize_order.py test/vs.svg test/vc.svg

python optimize.py test/vc.svg test/vopt
python colorize_order.py test/vopt.svg test/voptc.svg
inkscape test/voptc.svg

vpype read test/voptc.svg stat | grep Pen-up