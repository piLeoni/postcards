import sys
import xml.etree.ElementTree as ET
import subprocess


def get_id(target_id, svg_file):
    tree = ET.parse(svg_file)
    root = tree.getroot()

    index = 1
    for elem in root.iter():
        if elem.tag.endswith('g') and 'id' in elem.attrib:
            if elem.attrib['id'] == target_id:
                return index
            index += 1
    return None


# Example usage:
if __name__ == "__main__":
    svg_file = sys.argv[1]
    output = sys.argv[2]

    # Call as needed:
    print(svg_file)
    
    outlines = get_id("outlines", svg_file)
    roads = get_id("roads", svg_file)
    buildings = get_id("buildings", svg_file)
    buildings_filling = get_id("buildings_filling", svg_file)
    water = get_id("water", svg_file)
    water_filling = get_id("water_filling", svg_file)
    parks = get_id("parks", svg_file)
    parks_filling = get_id("parks_filling", svg_file)
    
    
    # print("roads", roads)
    # print("buildings", buildings)
    # print("buildings_filling", buildings_filling)
    # print("water", water)
    # print("water_filling", water_filling)
    # print("parks", parks)
    # print("parks_filling", parks_filling)
    # print("buildings", buildings)
    args = ['vpype', '--config', 'vpype.toml']
    args += ['read', svg_file]
    args += 'trim 3mm 3mm'.split()
    # args +=  *"--config vpype.toml".split(),
    # Common parameters
    linesnap_tol = '0.05mm'
    linesimplify_tol = '0.1mm'
    deduplicate_tol = '0.15mm'
    linemerge_tol = '0.4mm'
    filter_minlen = '0.3mm'
    linesort_passes = '1000'
    linesort_t = '-t'
    
    # args += 'snap -t 0.1mm'.split()

    if outlines is not None:
        print("optimizing outlines")
        print(f"Layer ID for outlines: {outlines}")
        args += [
            *f'snap -l {str(outlines)} {linesnap_tol}'.split(),
            *f'linesimplify -l {str(outlines)} -t {linesimplify_tol}'.split(),
            *f'deduplicate  -l {str(outlines)} -p -t {deduplicate_tol}'.split(),
            *f'linemerge --layer {str(outlines)} -t {linemerge_tol}'.split(),
            *f'filter -l {str(outlines)} -m {filter_minlen}'.split(),
            *f'linesort -l {str(outlines)} {linesort_t} -p {linesort_passes}'.split(),
        ]
    if roads is not None:
        args += [
            *f'linesimplify -l {str(roads)} -t {linesimplify_tol}'.split(),
            *f'linemerge -l {str(roads)} -t {linemerge_tol}'.split(),
            *f'filter -l {str(roads)} -m {filter_minlen}'.split(),
            *f'linesort -l {str(roads)} {linesort_t} -p {linesort_passes}'.split(),
        ]
    if buildings is not None:
        args += [
            *f'linesimplify -l {str(buildings)} -t {linesimplify_tol}'.split(),
            *f'linemerge -l {str(buildings)} -t {linemerge_tol}'.split(),
            *f'filter -l {str(buildings)} -m {filter_minlen}'.split(),
            *f'linesort -l {str(buildings)} {linesort_t} -p {linesort_passes}'.split(),
            *f'linesimplify -l {str(buildings)} -t {linesimplify_tol}'.split(),
            *f'linemerge -l {str(buildings)} -t {linemerge_tol}'.split(),
            *f'filter -l {str(buildings)} -m {filter_minlen}'.split(),
            *f'linesort -l {str(buildings)} {linesort_t} -p {linesort_passes}'.split(),
        ]
    if buildings_filling is not None:
        args += [
            *f'linesimplify -l {str(buildings_filling)} -t {linesimplify_tol}'.split(),
            *f'linemerge -l {str(buildings_filling)} -t 1mm'.split(),
            *f'filter -l {str(buildings_filling)} -m {filter_minlen}'.split(),
            *f'linesort -l {str(buildings_filling)} {linesort_t} -p {linesort_passes}'.split(),
        ]
    if water is not None:
        args += [
            *f'linesimplify -l {str(water)} -t {linesimplify_tol}'.split(),
            *f'linemerge -l {str(water)} -t {linemerge_tol}'.split(),
            *f'filter -l {str(water)} -m {filter_minlen}'.split(),
            *f'linesort -l {str(water)} {linesort_t} -p {linesort_passes}'.split(),
        ]
    if water_filling is not None:
        args += [
            *f'linesimplify -l {str(water_filling)} -t 0.02mm'.split(),
            # *f'linemerge -l {str(water_filling)} -t 1mm'.split(),
            *f'filter -l {str(water_filling)} -m {filter_minlen}'.split(),
            *f'linesort -l {str(water_filling)} -f {linesort_t} -p {linesort_passes}'.split(),
        ]
    if parks is not None:
        args += [
            *f'linesimplify -l {str(parks)} -t {linesimplify_tol}'.split(),
            *f'linemerge -l {str(parks)} -t {linemerge_tol}'.split(),
            *f'filter -l {str(parks)} -m {filter_minlen}'.split(),
            *f'linesort -l {str(parks)} {linesort_t} -p {linesort_passes}'.split(),
        ]
    if parks_filling is not None:
        args += [
            *f'linesort -l {str(parks_filling)} -f'.split(),
        ]
        # Add any processing steps for parks_filling here if needed
        pass
    
   

    # args += 'deduplicate -t 0.1mm'.split()
    args += f'penwidth 0.1mm'.split()
    args += f'write -m layer {output}.svg'.split()
    args += f'gwrite --profile plotter {output}.gcode'.split()

    result = subprocess.run(args, check=True)
    print("saved", output)

    
    
    
