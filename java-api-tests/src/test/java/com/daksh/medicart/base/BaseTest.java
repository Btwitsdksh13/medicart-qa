package com.daksh.medicart.base;

import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.BeforeMethod;

import java.util.Map;
import java.util.UUID;

/** Shared setup: base URL from -DbaseUrl, fresh backend state and a unique user for every test. */
public abstract class BaseTest {
    protected static String baseUrl = System.getProperty("baseUrl", "http://localhost:3100");
    protected String user;

    @BeforeClass
    public void configure() {
        RestAssured.baseURI = baseUrl;
        RestAssured.enableLoggingOfRequestAndResponseIfValidationFails();
    }

    @BeforeMethod
    public void freshState() {
        RestAssured.given().post("/api/test/reset").then().statusCode(200);
        user = "u-" + UUID.randomUUID();
    }

    protected RequestSpecification as(String userId) {
        return RestAssured.given().contentType(ContentType.JSON).header("x-user-id", userId);
    }

    protected RequestSpecification asUser() { return as(user); }

    protected Response addToCart(String userId, String medicineId, Object qty) {
        return as(userId).body(Map.of("medicineId", medicineId, "qty", qty)).post("/api/cart/items");
    }

    protected Response addToCart(String medicineId, int qty) { return addToCart(user, medicineId, qty); }

    protected Response placeOrder(String userId, Map<String, Object> body) {
        return as(userId).body(body).post("/api/orders");
    }

    protected String prescription(String userId) {
        return as(userId).body(Map.of("fileName", "rx.pdf")).post("/api/prescriptions").then().statusCode(201).extract().path("id");
    }

    protected String placedOrderId() {
        addToCart("M1", 1);
        return placeOrder(user, Map.of("paymentMethod", "UPI")).then().statusCode(201).extract().path("id");
    }
}
