from fractions import Fraction

import pytest

import office_calc as c


def test_split_points_is_exact_and_multiple_of_step():
    r = c.split_points({"weights": [1, 1, 1, 2, 2, 3], "total": 10, "step": 0.25})
    assert sum(Fraction(str(p)) for p in r["points"]) == 10
    assert all(Fraction(str(p)) % Fraction(1, 4) == 0 for p in r["points"])
    assert r["points"][5] >= r["points"][3] >= r["points"][0] - 0.25  # heavier questions never get less


def test_split_points_equal_weights_and_eighth_step():
    r = c.split_points({"weights": [1] * 16, "total": 4, "step": 0.25})
    assert r["points"] == [0.25] * 16
    r = c.split_points({"weights": [3, 1, 1, 1], "total": 3, "step": 0.125})
    assert sum(Fraction(str(p)) for p in r["points"]) == 3 and all(Fraction(str(p)) % Fraction(1, 8) == 0 for p in r["points"])


def test_split_points_accepts_decimal_comma_and_strings():
    r = c.split_points({"weights": ["1,5", 1], "total": "10", "step": "0,5"})
    assert sum(r["points"]) == 10


@pytest.mark.parametrize("args", [
    {"weights": [], "total": 10}, {"weights": [1, -1], "total": 10}, {"weights": [1, 1], "total": 10.1, "step": 0.25},
    {"weights": [1] * 50, "total": 5, "step": 0.25}, {"weights": [1], "total": 0}, {"weights": "abc", "total": 10}, {"weights": [True], "total": 1},
])
def test_split_points_bad_input(args):
    with pytest.raises(c.CalcError):
        c.split_points(args)


def students(scores):
    return [{"name": f"HS{i:02d}", "score": s} for i, s in enumerate(scores)]


def test_balanced_groups_sizes_and_everyone_placed_once():
    items = students([9.5, 9, 8.75, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4, 3.5, 3, 2.5, 9.25, 6.25, 1])
    r = c.balanced_groups({"items": items, "groups": 4})
    assert sorted(r["sizes"]) == [4, 4, 4, 5] and max(r["sizes"]) - min(r["sizes"]) <= 1
    names = [m["name"] for g in r["groups"] for m in g["members"]]
    assert sorted(names) == sorted(i["name"] for i in items)
    assert r["spread"] <= 0.6


def test_balanced_groups_beats_naive_split():
    items = students([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0])
    r = c.balanced_groups({"items": items, "groups": 3})
    naive = [sum(i["score"] for i in items[k * 4:(k + 1) * 4]) / 4 for k in range(3)]
    assert r["spread"] < max(naive) - min(naive)


def test_balanced_groups_is_deterministic():
    items = students([5, 5, 5, 6, 7, 8, 8, 9])
    assert c.balanced_groups({"items": items, "groups": 2}) == c.balanced_groups({"items": items, "groups": 2})


def test_balanced_groups_realistic_class_is_fast():
    import random
    import time

    random.seed(3)
    items = students([round(random.uniform(0, 10) * 4) / 4 for _ in range(48)])
    t = time.time()
    r = c.balanced_groups({"items": items, "groups": 8})
    assert time.time() - t < 4 and r["spread"] < 0.3 and r["sizes"] == [6] * 8


@pytest.mark.parametrize("args", [
    {"items": [], "groups": 2}, {"items": students([1]), "groups": 2}, {"items": students([1, 2, 3]), "groups": 1},
    {"items": students([1, 2, 3]), "groups": 4}, {"items": [{"name": "a"}, {"name": "b"}], "groups": 2}, {"items": students(["x", 2]), "groups": 2},
])
def test_balanced_groups_bad_input(args):
    with pytest.raises(c.CalcError):
        c.balanced_groups(args)
