import numpy as np
import pprint
from scipy.spatial import distance_matrix
import fast_tsp
import shapely
from shapely.geometry import Point, LineString, Polygon, MultiLineString, MultiPolygon
from utils.ops import flatten, geometry_to_linestrings, polygons_to_linestrings, multilinestring_to_linestrings, multipolygon_to_polygons
from ortools.constraint_solver import pywrapcp
from ortools.constraint_solver import routing_enums_pb2
import math





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
    if len(coordinates) > 2:
        # Solve TSP and get optimal order of indices
        optimal_indices = solve_tsp_cartesian_indices(coordinates)
        # Return ordered geometries based on optimal indices
        ordered_geometries = [geometries[i] for i in optimal_indices]
        # ordered_geometries = join_consecutive_geometries(ordered_geometries, threshold=5)
        # ordered_geometries = shapely.ops.unary_union(ordered_geometries)

        return ordered_geometries
    else:
        return geometries





def compute_distance_matrix(geometries):
    num_geometries = len(geometries)
    distance_matrix = np.zeros((num_geometries, num_geometries))

    for g in range(num_geometries):
        for n in range(num_geometries):
            s_s = math.dist(geometries[g][0], geometries[n][0])
            s_e = math.dist(geometries[g][0], geometries[n][-1])
            e_s = math.dist(geometries[g][-1], geometries[n][0])
            e_e = math.dist(geometries[g][-1], geometries[n][-1])

            # Use the minimum distance (taking into account potential reversal)
            distance_matrix[g, n] = min(s_s, s_e, e_s, e_e)
    
    return distance_matrix


def connect_nearby_paths(paths, tolerance):
    """
    Connects nearby paths (LineStrings) within a given tolerance.

    Args:
        paths: A list of Shapely LineString objects or a MultiLineString.
        tolerance: The maximum distance between endpoints to consider them "nearby".

    Returns:
        A Shapely MultiLineString containing the connected paths.
    """
    geometries = flatten([geometry_to_linestrings(path) for path in paths])

    optimized = []
    coordinates = []
    for i, g in enumerate(geometries):
        if i > 0:
            if math.dist(g.coords[0], geometries[i-1].coords[-1]) < tolerance:
                coordinates += g.coords
            # elif math.dist(g.coords[0], geometries[i-1].coords[0]) < tolerance:
            #     coordinates += g.coords[::-1]

            else:
                optimized.append(LineString(coordinates))
                coordinates = []
                coordinates += g.coords
        else:
            coordinates += g.coords
    
    return optimized
     