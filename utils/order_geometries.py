import numpy as np
import pprint
from scipy.spatial import distance_matrix
import fast_tsp
import shapely
from shapely.geometry import Point, LineString, Polygon, MultiLineString, MultiPolygon

def join_consecutive_geometries(geometries, threshold):
    """Joins consecutive geometries if their distance is below the threshold."""
    joined_geometries = []
    current_geom = geometries[0]

    for i in range(1, len(geometries)):
        next_geom = geometries[i]
        # Calculate the distance between the current and next geometry
        dist = current_geom.distance(next_geom)
        
        if dist < threshold:
            # If the distance is below the threshold, we merge the two geometries
            current_geom = shapely.ops.unary_union([current_geom, next_geom])
        else:
            # If the distance is above the threshold, add the current geometry to the result
            joined_geometries.append(current_geom)
            current_geom = next_geom
    
    # Add the last geometry in case it's not already added
    joined_geometries.append(current_geom)

    return joined_geometries


def shapely_to_coordinates(geometries):
    """Converts Shapely geometries to a list of coordinates, handling all geometry types."""
    coordinates = []
    for geom in geometries:
        if isinstance(geom, Point):
            coordinates.append(list(geom.coords[0]))
        elif isinstance(geom, LineString):
            coordinates.append(list(geom.coords[0]))  # Use start point
        elif isinstance(geom, Polygon):
            coordinates.append(list(geom.boundary.coords[0]))  # Use first boundary point
        elif isinstance(geom, MultiLineString):
            if geom.geoms:
                coordinates.append(list(geom.geoms[0].coords[0]))
            else:
                coordinates.append([0, 0])  # Default for empty MultiLineString
        elif isinstance(geom, MultiPolygon):
            if geom.geoms and geom.geoms[0].boundary.coords:
                coordinates.append(list(geom.geoms[0].boundary.coords[0]))
            else:
                coordinates.append([0, 0])  # Default for empty MultiPolygon
        else:
            raise ValueError("Unsupported geometry type")
    return np.array(coordinates)

def solve_tsp_cartesian_indices(points):
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

def order_geometries_tsp(geometries):
    # Convert Shapely geometries to coordinates
    coordinates = shapely_to_coordinates(geometries)
    # Solve TSP and get optimal order of indices
    optimal_indices = solve_tsp_cartesian_indices(coordinates)
    # Return ordered geometries based on optimal indices
    ordered_geometries = [geometries[i] for i in optimal_indices]
    # ordered_geometries = join_consecutive_geometries(ordered_geometries, threshold=5)
    # ordered_geometries = shapely.ops.unary_union(ordered_geometries)

    return ordered_geometries

