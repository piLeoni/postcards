vpype read test/vs.svg \
    linemerge --tolerance 1000 --layer 2 \
    # all \
    write test/v_opt2.svg

python colorize_order.py test/v_opt.svg test/out.svg
inkscape test/out.svg 

