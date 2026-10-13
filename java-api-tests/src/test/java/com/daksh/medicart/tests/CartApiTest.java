package com.daksh.medicart.tests;

import com.daksh.medicart.base.BaseTest;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

public class CartApiTest extends BaseTest {

    @Test(description = "Cart requires the auth header")
    public void requiresAuth() {
        given().get("/api/cart").then().statusCode(401).body("error", equalTo("UNAUTHORIZED"));
    }

    @Test(description = "Totals include delivery fee below 500")
    public void totalsWithDeliveryFee() {
        addToCart("M1", 2).then().statusCode(201)
                .body("subtotal", equalTo(60)).body("delivery", equalTo(40)).body("total", equalTo(100));
    }

    @Test(description = "Delivery fee boundary: 480 pays fee, 510 is free")
    public void deliveryBoundary() {
        addToCart("M2", 4);
        asUser().get("/api/cart").then().body("delivery", equalTo(40));
        addToCart("M1", 1);
        asUser().get("/api/cart").then().body("delivery", equalTo(0));
    }

    @Test(description = "Adding the same medicine merges quantity")
    public void mergesQuantity() {
        addToCart("M1", 2);
        addToCart("M1", 3).then().body("items.size()", equalTo(1)).body("items[0].qty", equalTo(5));
    }

    @DataProvider(name = "invalidQty")
    public Object[][] invalidQty() { return new Object[][]{{0}, {-1}, {11}, {1.5}, {"a"}}; }

    @Test(dataProvider = "invalidQty", description = "Invalid quantities are rejected")
    public void rejectsInvalidQty(Object qty) {
        addToCart(user, "M1", qty).then().statusCode(400).body("error", equalTo("INVALID_QTY"));
    }

    @Test(description = "Out-of-stock medicine cannot be added")
    public void outOfStock() {
        addToCart("M5", 1).then().statusCode(409).body("error", equalTo("OUT_OF_STOCK"));
    }

    @Test(description = "Cannot exceed available stock across multiple adds")
    public void stockLimit() {
        addToCart("M4", 4);
        addToCart("M4", 2).then().statusCode(409).body("error", equalTo("INSUFFICIENT_STOCK"));
    }

    @Test(description = "Percent coupon applies discount (case-insensitive code)")
    public void percentCoupon() {
        addToCart("M2", 2);
        asUser().body(Map.of("code", "health10")).post("/api/cart/coupon")
                .then().statusCode(200).body("discount", equalTo(24)).body("total", equalTo(256));
    }

    @DataProvider(name = "badCoupons")
    public Object[][] badCoupons() { return new Object[][]{{"EXPIRED20", 410, "COUPON_EXPIRED"}, {"WHAT", 404, "INVALID_COUPON"}}; }

    @Test(dataProvider = "badCoupons", description = "Expired and unknown coupons are rejected")
    public void badCoupon(String code, int status, String error) {
        addToCart("M2", 2);
        asUser().body(Map.of("code", code)).post("/api/cart/coupon").then().statusCode(status).body("error", equalTo(error));
    }

    @Test(description = "Flat coupon enforces minimum order value")
    public void minimumOrder() {
        addToCart("M1", 2);
        asUser().body(Map.of("code", "FLAT50")).post("/api/cart/coupon")
                .then().statusCode(422).body("error", equalTo("MIN_ORDER_NOT_MET"));
    }

    @Test(description = "Carts are isolated between users")
    public void isolatedCarts() {
        addToCart("M1", 1);
        as("someone-else").get("/api/cart").then().body("items.size()", equalTo(0));
    }
}
