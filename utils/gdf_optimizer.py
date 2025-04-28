import geopandas as gpd
import pandas as pd
from shapely.geometry import Point, LineString, Polygon
from shapely.ops import transform
import numpy as np
import warnings
import networkx as nx

def get_start_end_points(geometry):
    """Extracts start and end points from LineString or Polygon."""
    if isinstance(geometry, LineString):
        # Ensure it's not just a point masquerading as a line
        if len(geometry.coords) < 2:
             warnings.warn(f"Geometry {geometry.wkt} has fewer than 2 coordinates, treating as point.")
             return geometry.coords[0], geometry.coords[0] # Start and end are the same
        return geometry.coords[0], geometry.coords[-1]
    elif isinstance(geometry, Polygon):
        # For polygons, start and end are the same (first point of exterior ring)
        # Check if exterior exists and has coordinates
        if geometry.exterior is None or len(geometry.exterior.coords) == 0:
             warnings.warn(f"Polygon {geometry.wkt} has no exterior or coordinates, skipping.")
             return None, None # Cannot process
        return geometry.exterior.coords[0], geometry.exterior.coords[0]
    else:
        warnings.warn(f"Unsupported geometry type: {type(geometry)}. Only LineString and Polygon are supported.")
        return None, None # Indicate unsupported type


def reverse_geom(geometry):
    """Reverses the coordinates of a LineString."""
    if isinstance(geometry, LineString):
        if len(geometry.coords) < 2: # Cannot reverse a point or single-coord line
            return geometry
        return LineString(list(geometry.coords)[::-1])
    # Polygons are not reversed as start/end are the same
    return geometry

def calculate_distance_sq(p1, p2):
    """Calculates squared Euclidean distance between two points (tuples)."""
    # Using squared distance avoids sqrt, making comparisons faster.
    # The actual distance value isn't needed, only which is smaller.
    if p1 is None or p2 is None:
        return float('inf') # Cannot calculate distance involving None
    dx = p1[0] - p2[0]
    dy = p1[1] - p2[1]
    return dx*dx + dy*dy

def gdf_optimize_paths(gdf):
    """
    Optimizes the drawing order of geometries in a GeoDataFrame for a pen plotter.

    Minimizes travel distance by reordering paths and potentially reversing
    LineStrings. Polygons are kept in their original orientation.

    Args:
        gdf (geopandas.GeoDataFrame): Input GeoDataFrame with LineString
                                      and Polygon geometries.

    Returns:
        geopandas.GeoDataFrame: A new GeoDataFrame with geometries sorted and
                                potentially reversed for optimized plotting,
                                preserving original columns. Returns an empty
                                GDF if the input is empty or invalid.
                                Returns the original GDF if only one valid
                                geometry exists.
    """
    if not isinstance(gdf, gpd.GeoDataFrame) or gdf.empty:
        print("Input is not a valid GeoDataFrame or is empty.")
        return gpd.GeoDataFrame(geometry=[], crs=gdf.crs)

    # 1. Pre-process: Extract info and filter valid geometries
    original_indices = []
    start_points = []
    end_points = []
    geom_types = []
    geometries = []
    original_data = [] # To store other column data

    # Create a copy to avoid modifying the original GDF's index if we drop rows
    gdf_copy = gdf.copy()
    valid_indices = []

    for index, row in gdf_copy.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            warnings.warn(f"Skipping empty geometry at index {index}")
            continue

        start, end = get_start_end_points(geom)
        if start is None: # Handle unsupported types or invalid polygons
            warnings.warn(f"Skipping invalid or unsupported geometry at index {index}")
            continue

        original_indices.append(index)
        start_points.append(start)
        end_points.append(end)
        geom_types.append(type(geom))
        geometries.append(geom)
        # Store other data associated with the row, keyed by the original index
        original_data.append(row.drop('geometry').to_dict())
        valid_indices.append(len(original_indices) - 1) # Index within our filtered lists

    num_geoms = len(original_indices)
    if num_geoms == 0:
        print("No valid LineString or Polygon geometries found.")
        return gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
    if num_geoms == 1:
        print("Only one valid geometry, no optimization needed.")
        # Reconstruct the single-row GDF
        single_row_data = original_data[0]
        single_row_data['geometry'] = geometries[0]
        return gpd.GeoDataFrame([single_row_data], crs=gdf.crs)


    # 2. Nearest Neighbor Algorithm
    unvisited_mask = np.ones(num_geoms, dtype=bool)
    optimized_indices_order = [] # Stores tuples: (list_index, reversed_flag)
    current_list_idx = 0 # Start with the first valid geometry in our list

    # Optional: Find a better starting point (e.g., closest to origin 0,0)
    # min_dist_to_origin_sq = float('inf')
    # start_node = 0
    # for i in range(num_geoms):
    #     dist_sq = calculate_distance_sq((0,0), start_points[i])
    #     if dist_sq < min_dist_to_origin_sq:
    #         min_dist_to_origin_sq = dist_sq
    #         start_node = i
    # current_list_idx = start_node
    # print(f"Starting optimization from geometry index {original_indices[current_list_idx]}")


    # Initial state: Add the starting geometry (never reversed initially)
    optimized_indices_order.append((current_list_idx, False))
    unvisited_mask[current_list_idx] = False
    current_pos = end_points[current_list_idx] # Position after drawing the first shape

    while np.any(unvisited_mask):
        min_dist_sq = float('inf')
        best_next_list_idx = -1
        reverse_next = False

        # Find the closest reachable point among remaining geometries
        for next_list_idx in np.where(unvisited_mask)[0]:
            geom_type = geom_types[next_list_idx]
            next_start_pt = start_points[next_list_idx]
            next_end_pt = end_points[next_list_idx]

            # Option 1: Travel to the start point of the next geometry
            dist_sq_to_start = calculate_distance_sq(current_pos, next_start_pt)
            if dist_sq_to_start < min_dist_sq:
                min_dist_sq = dist_sq_to_start
                best_next_list_idx = next_list_idx
                reverse_next = False # Draw it forward

            # Option 2 (Only for LineStrings): Travel to the end point
            if geom_type is LineString:
                dist_sq_to_end = calculate_distance_sq(current_pos, next_end_pt)
                if dist_sq_to_end < min_dist_sq:
                    min_dist_sq = dist_sq_to_end
                    best_next_list_idx = next_list_idx
                    reverse_next = True # Draw it reversed

        # Add the best found geometry to the optimized order
        optimized_indices_order.append((best_next_list_idx, reverse_next))
        unvisited_mask[best_next_list_idx] = False

        # Update current position for the next iteration
        if reverse_next:
            # If reversed, we end at its original start point
            current_pos = start_points[best_next_list_idx]
        else:
            # If not reversed, we end at its original end point
            current_pos = end_points[best_next_list_idx]

        current_list_idx = best_next_list_idx # Keep track (though not strictly needed anymore)


    # 3. Construct the new GeoDataFrame
    optimized_geoms = []
    new_data = []
    original_index_order = []

    for list_idx, reversed_flag in optimized_indices_order:
        geom = geometries[list_idx]
        if reversed_flag:
            optimized_geom = reverse_geom(geom) # reverse_geom handles non-LineStrings safely
        else:
            optimized_geom = geom

        optimized_geoms.append(optimized_geom)
        # Retrieve the original associated data using the list_idx
        new_data.append(original_data[list_idx])
        # Keep track of the original gdf index for reference if needed
        original_index_order.append(original_indices[list_idx])


    # Create the final GeoDataFrame
    # Combine the geometry with the other data
    final_df_data = []
    for i in range(len(optimized_geoms)):
        row_data = new_data[i].copy() # Start with non-geometry data
        row_data['geometry'] = optimized_geoms[i] # Add the (potentially reversed) geometry
        # Optionally add the original index and reversal flag if desired
        # row_data['original_gdf_index'] = original_index_order[i]
        # row_data['was_reversed'] = optimized_indices_order[i][1]
        final_df_data.append(row_data)

    optimized_gdf = gpd.GeoDataFrame(final_df_data, crs=gdf.crs)

    return optimized_gdf

def merge_consecutive_paths_by_distance(gdf, distance_threshold):
    output = []
    partial = []
    
    def flush_partial():
        nonlocal partial
        if(len(partial) > 0):
            output.append(LineString([pt for line in partial for pt in line.coords]))
            partial = []
            
    for i in range(len(gdf)):  
        if isinstance(gdf.iloc[i].geometry, LineString):
            if(len(partial) > 0):
                if(calculate_distance_sq(gdf.iloc[i].geometry.coords[0], partial[-1].coords[-1]) > distance_threshold):
                    flush_partial()
            partial.append(gdf.iloc[i].geometry)
        else:
            flush_partial()
            partial = []
            output.append(gdf.iloc[i].geometry)
            
    flush_partial()

    return  gpd.GeoDataFrame(geometry=output)

def merge_paths_by_distance(gdf, tolerance):
    """
    Merge LineStrings in a GeoDataFrame that have start or end points within a certain distance.

    Parameters:
    - gdf: GeoDataFrame with LineStrings
    - tolerance: maximum distance to consider two lines connected

    Returns:
    - GeoDataFrame with merged lines
    """
    # Make a copy to avoid modifying the original
    gdf = gdf.copy()

    # Create a list of (start_point, end_point) for each line
    endpoints = []
    for geom in gdf.geometry:
        if isinstance(geom, LineString):
            coords = list(geom.coords)
            endpoints.append((Point(coords[0]), Point(coords[-1])))
        else:
            endpoints.append((None, None))

    merged = []
    used = set()

    for idx, (start, end) in enumerate(endpoints):
        if idx in used:
            continue
        current_line = gdf.geometry.iloc[idx]
        changed = True
        
        while changed:
            changed = False
            for j, (other_start, other_end) in enumerate(endpoints):
                if j in used or j == idx:
                    continue

                # Check distances between endpoints
                dists = [
                    (start.distance(other_start), 'start', 'start'),
                    (start.distance(other_end), 'start', 'end'),
                    (end.distance(other_start), 'end', 'start'),
                    (end.distance(other_end), 'end', 'end')
                ]
                min_dist, this_end, other_end_type = min(dists, key=lambda x: x[0])

                if min_dist <= tolerance:
                    # Merge the lines
                    other_line = gdf.geometry.iloc[j]
                    if other_end_type == 'start':
                        new_other = list(other_line.coords)
                    else:  # if matching to the end, reverse
                        new_other = list(other_line.coords)[::-1]

                    if this_end == 'start':
                        new_coords = new_other + list(current_line.coords)
                    else:
                        new_coords = list(current_line.coords) + new_other

                    current_line = LineString(new_coords)
                    start = Point(current_line.coords[0])
                    end = Point(current_line.coords[-1])

                    used.add(j)
                    changed = True
                    break  # restart looking

        merged.append(current_line)
        used.add(idx)
    return gpd.GeoDataFrame(geometry=merged, crs=gdf.crs)



def representative_point(geom):
    """Get a representative point for different geometry types."""
    if geom.geom_type == 'Point':
        return geom
    elif geom.geom_type == 'LineString':
        return Point(geom.coords[0])  # start point
    elif geom.geom_type == 'Polygon':
        return geom.centroid
    else:
        return geom.representative_point()

import fast_tsp
from scipy.spatial import distance_matrix


def shapely_to_coordinates(geometries):
    """Convert Shapely geometries to coordinates (x, y), using the first coordinate."""
    coordinates = []
    for geom in geometries:
        if geom.geom_type == 'Point':
            coordinates.append((geom.x, geom.y))  # Use point itself
        elif geom.geom_type == 'LineString':
            # Use the first coordinate of the LineString
            coordinates.append((geom.coords[0][0], geom.coords[0][1]))
        elif geom.geom_type == 'Polygon':
            # Use the first coordinate of the Polygon's exterior
            coordinates.append((geom.exterior.coords[0][0], geom.exterior.coords[0][1]))
        else:
            # Handle other geometry types (take first coordinate)
            coordinates.append((geom.representative_point().x, geom.representative_point().y))
    return coordinates

def solve_tsp_cartesian_indices(points):
    """Solve TSP by calculating a distance matrix and using fast_tsp."""
    points = np.array(points)
    # Calculate the distance matrix
    distance_mat = distance_matrix(points, points)
    # Scale the distance matrix to avoid small values becoming equal
    scaling_factor = 1000  # Adjust as needed for your problem
    scaled_distance_mat = distance_mat * scaling_factor
    # Convert the scaled distances to integers
    scaled_distance_mat = scaled_distance_mat.astype(int)
    # Convert the NumPy array to a list of lists
    distance_mat_list = scaled_distance_mat.tolist()
    # Solve the TSP using the fast_tsp solver
    path = fast_tsp.find_tour(distance_mat_list)
    return path

def tsp_order(gdf):
    """
    Reorder geometries in a GeoDataFrame to minimize the travel distance using TSP.

    Parameters:
    - gdf: GeoDataFrame with mixed geometries (Points, LineStrings, Polygons, etc.)

    Returns:
    - Reordered GeoDataFrame
    """
    # Step 1: Convert geometries to coordinates
    coordinates = shapely_to_coordinates(gdf.geometry)
    
    if len(coordinates) > 2:
        # Step 2: Solve TSP and get optimal order of indices
        optimal_indices = solve_tsp_cartesian_indices(coordinates)
        
        # Step 3: Reorder geometries in GeoDataFrame
        ordered_geometries = [gdf.geometry.iloc[i] for i in optimal_indices]
        
        # Step 4: Return ordered GeoDataFrame
        ordered_gdf = gdf.iloc[optimal_indices].reset_index(drop=True)
        return ordered_gdf
    else:
        # If there are fewer than 3 geometries, no need to reorder
        return gdf