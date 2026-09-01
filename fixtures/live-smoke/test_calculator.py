from calculator import divide


def test_zero_divisor():
    assert divide(10, 0) == 0
